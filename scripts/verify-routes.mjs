// Check that a running instance serves the plugin contract.
//
// Points at anything speaking the plugin's HTTP surface — a real Harness instance, or the
// local playground — and verifies it the way a client would: the routes exist, the
// manifest and the art agree, sheets are only served from a whitelist, nothing is
// writable, and the desktop page stands on its own.
//
//   node scripts/verify-routes.mjs http://127.0.0.1:19387
//
// Exported as `verifyRoutes` so the tests can run the very same checks against the
// playground, which keeps the two surfaces from drifting apart.

const TIMEOUT_MS = 8000

function pngSize(bytes) {
  if (bytes.length < 24) return null
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  for (let index = 0; index < signature.length; index += 1) {
    if (bytes[index] !== signature[index]) return null
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return { width: view.getUint32(16), height: view.getUint32(20) }
}

async function request(url, options = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    return await fetch(url, { ...options, signal: controller.signal, redirect: 'manual' })
  } finally {
    clearTimeout(timer)
  }
}

/**
 * @param base origin without a trailing slash, e.g. `http://127.0.0.1:19387`
 * @param options.log called with `(ok, label, detail)` for every check
 * @returns `{ ok, checks }`
 */
export async function verifyRoutes(base, options = {}) {
  const log = options.log ?? (() => {})
  const api = `${base}/big-fat-fish-girl/v1`
  const checks = []
  const record = (ok, label, detail = '') => {
    checks.push({ ok, label, detail })
    log(ok, label, detail)
    return ok
  }

  // 1. State: the shape every client depends on.
  const state = await (await request(`${api}/state`)).json()
  record(state.apiVersion === 3, 'state.apiVersion', String(state.apiVersion))
  record(typeof state.mood === 'string', 'state.mood', state.mood)
  record(state.attention === null || Number.isInteger(state.attention?.count), 'state.attention shape', JSON.stringify(state.attention))
  record(state.team !== null && typeof state.team === 'object', 'state.team present', JSON.stringify(state.team))
  record(state.toolError === null || (typeof state.toolError?.id === 'string' && Number.isFinite(state.toolError?.seq)),
    'state.toolError shape', JSON.stringify(state.toolError))
  record('tool' in state, 'state.tool present', JSON.stringify(state.tool))
  record('navigation' in state, 'state.navigation present', JSON.stringify(state.navigation))
  record(state.prefs !== null && typeof state.prefs === 'object' && Number.isFinite(state.prefs.size),
    'state.prefs present', JSON.stringify(state.prefs))

  // 2. Manifest, and the art it points at.
  const manifest = await (await request(`${api}/manifest`)).json()
  record(manifest.version === 1, 'manifest.version', String(manifest.version))
  const sheetIds = Object.keys(manifest.sheets ?? {})
  record(sheetIds.length > 0, 'manifest.sheets', sheetIds.join(', '))
  record(manifest.animations.length > 0, 'manifest.animations', String(manifest.animations.length))

  const animationIds = new Set(manifest.animations.map((animation) => animation.id))
  const missingSheet = manifest.animations.filter((animation) => manifest.sheets[animation.sheet] === undefined)
  record(missingSheet.length === 0, 'animations reference existing sheets', missingSheet.map((a) => a.id).join(', '))

  const missingState = Object.entries(manifest.states ?? {})
    .filter(([, state2]) => !animationIds.has(state2.anim))
    .map(([name]) => name)
  record(missingState.length === 0, 'states reference existing animations', missingState.join(', '))

  const missingPhase = Object.entries(manifest.toolActs ?? {})
    .filter(([, anim]) => !animationIds.has(anim))
    .map(([phase]) => phase)
  record(missingPhase.length === 0, 'toolActs reference existing animations', missingPhase.join(', '))

  // 3. Every sheet is served, is a PNG, and matches the declared grid. Optional
  // sheets are declared before the artist draws them, so a 404 is allowed there.
  for (const [id, sheet] of Object.entries(manifest.sheets ?? {})) {
    const response = await request(`${api}/sheet/${encodeURIComponent(sheet.file)}`)
    if (sheet.optional === true && response.status === 404) {
      record(true, `sheet ${id} optional not drawn yet`, '404')
      continue
    }
    if (!record(response.status === 200, `sheet ${id} served`, `${response.status}`)) continue
    const size = pngSize(new Uint8Array(await response.arrayBuffer()))
    if (!record(size !== null, `sheet ${id} is a PNG`)) continue
    record(
      size.width === sheet.columns * sheet.cellWidth && size.height === sheet.rows * sheet.cellHeight,
      `sheet ${id} geometry`,
      `${size.width}x${size.height} vs ${sheet.columns * sheet.cellWidth}x${sheet.rows * sheet.cellHeight}`,
    )
  }

  // 4. The installed skins, their list and the manifest's per-skin sheet URLs.
  const skins = await (await request(`${api}/skins`)).json()
  record(Array.isArray(skins) && skins.length > 0, 'skins installed', JSON.stringify(skins))
  const skinUrl = manifest.sheets?.base?.url
  if (record(typeof skinUrl === 'string' && skinUrl.startsWith('/'), 'manifest sheet URL is skin-relative', String(skinUrl))) {
    const response = await request(`${base}${skinUrl}`)
    record(response.status === 200, 'skin sheet served', String(response.status))
  }

  // 5. The base sheet keeps its long-standing legacy route.
  const atlas = await request(`${api}/atlas.png`)
  record(atlas.status === 200, 'atlas.png (legacy route)', String(atlas.status))

  // 5. Sheets come from a whitelist, never from the filesystem.
  for (const attempt of ['../package.json', '%2e%2e/package.json', 'lib/index.mjs']) {
    const response = await request(`${api}/sheet/${attempt}`)
    record(response.status === 404, `sheet traversal blocked: ${attempt}`, String(response.status))
  }

  // 6. Nothing is writable: this plugin only reads.
  const write = await request(`${api}/state`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
  record(write.status !== 200, 'state is read-only', String(write.status))

  // 7. The desktop page stands on its own.
  const page = await request(`${api}/desktop`)
  if (record(page.status === 200, 'desktop page served', String(page.status))) {
    const html = await page.text()
    record(html.includes('__BFFG_SHELL__'), 'desktop page declares the shell bridge')
    const external = html.match(/<(?:script|link)[^>]*(?:src|href)=/gi) ?? []
    record(external.length === 0, 'desktop page is self-contained', external.join(', '))
    record(html.includes('__BFFG_DESKTOP__'), 'desktop page exposes its entry point')
  }

  // 8. The event stream opens with a snapshot.
  const events = await request(`${api}/events`)
  if (record(events.status === 200, 'events stream opens', String(events.status))) {
    const reader = events.body.getReader()
    const first = new TextDecoder().decode((await reader.read()).value ?? new Uint8Array())
    await reader.cancel()
    record(first.includes('event: snapshot'), 'events sends a snapshot first', first.split('\n')[0])
  }

  return { ok: checks.every((check) => check.ok), checks }
}

const invokedDirectly = process.argv[1] !== undefined && process.argv[1].endsWith('verify-routes.mjs')
if (invokedDirectly) {
  const base = (process.argv[2] ?? 'http://127.0.0.1:19387').replace(/\/$/, '')
  const { ok, checks } = await verifyRoutes(base, {
    log: (passed, label, detail) => console.log(`${passed ? '  ok  ' : ' FAIL '} ${label}${detail === '' ? '' : ` — ${detail}`}`),
  })
  const failed = checks.filter((check) => !check.ok).length
  console.log(`\n${ok ? 'contract OK' : 'CONTRACT BROKEN'} — ${checks.length - failed}/${checks.length} checks passed on ${base}`)
  process.exit(ok ? 0 : 1)
}
