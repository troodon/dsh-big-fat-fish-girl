// A local playground for the pet, with no DeepSeek Harness in sight.
//
// It serves the same contract the plugin's host half serves — state, events, manifest,
// the sheets — plus a page that mounts the real browser bundle and lets you flip the
// session state by hand. That makes it the fastest way to see a behaviour change
// without booting the app, and the only place where tool phases can be tried on purpose
// instead of waiting for a real tool call.
//
//   node preview/server.mjs [--port 41739]
//
// Development-only: it binds to loopback, serves nothing outside the repository, and the
// /preview/state endpoint exists only here.
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { API_PREFIX, SNAPSHOT_VERSION } from '../lib/protocol/contract.mjs'
import { DEFAULT_MANIFEST } from '../lib/animation/manifest.mjs'
import { DEFAULT_PREFS, normalisePrefs } from '../lib/settings/prefs.mjs'
import { TRANSIENT_MS } from '../lib/host/model.mjs'
import { manifestForSkin } from '../lib/host/host-routes.mjs'
import { DEFAULT_SKIN, listSkins, resolveSkin } from '../lib/host/skins.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const API = API_PREFIX

const portIndex = process.argv.indexOf('--port')
const port = portIndex === -1 ? 41739 : Number(process.argv[portIndex + 1])

const SHEET_FILES = new Set(
  Object.values(DEFAULT_MANIFEST.sheets).map((sheet) => sheet.file).filter(Boolean),
)

let toolSeq = 0
const PREVIEW_TARGET = 'preview-session'
const state = {
  apiVersion: SNAPSHOT_VERSION,
  revision: 0,
  mood: 'idle',
  activeSessions: 0,
  until: 0,
  phase: null,
  tool: null,
  attention: null,
  navigation: null,
  team: { active: 0, waiting: 0, completed: 0, errors: 0, coordinating: false },
  toolError: null,
  prefs: { ...DEFAULT_PREFS },
}
const clients = new Set()

/** The skin the playground is showing; unknown ids fall back like the host does. */
const activeSkin = () => resolveSkin(state.prefs.skin) ?? DEFAULT_SKIN

function publish() {
  state.revision += 1
  const payload = `event: snapshot\ndata: ${JSON.stringify(state)}\n\n`
  for (const client of clients) client.write(payload)
}

/** Preview-only: pretend the session did something, so the pet reacts to it. */
export function patchState(patch) {
  let dirty = false
  if (typeof patch.mood === 'string') {
    dirty = true
    state.mood = patch.mood
    state.until = TRANSIENT_MS[patch.mood] === undefined ? 0 : Date.now() + TRANSIENT_MS[patch.mood]
    state.activeSessions = ['welcome', 'running', 'review', 'failed', 'limited'].includes(patch.mood) ? 1 : 0
    // Waiting is a mood on the wire, and the request it stands for is the attention.
    state.attention = patch.mood === 'waiting'
      ? { kind: 'approval', count: 1, targetRef: PREVIEW_TARGET }
      : null
    state.navigation = state.attention !== null
      ? { kind: 'attention', targetRef: PREVIEW_TARGET }
      : (state.activeSessions > 0 ? { kind: 'task', targetRef: PREVIEW_TARGET } : null)
  }
  // Tool first, then an explicit phase: a "composing" button clears the tool and then
  // sets the assistant phase, which is how a reply differs from editing a file.
  if (patch.tool === null) {
    if (state.tool !== null) dirty = true
    state.tool = null
    state.phase = null
  } else if (patch.tool && typeof patch.tool.phase === 'string') {
    dirty = true
    toolSeq += 1
    // Open-ended while the playground says so; `open: false` mimics a finished call.
    state.tool = { phase: patch.tool.phase, seq: toolSeq, open: patch.tool.open !== false }
    if (state.tool.open) state.phase = patch.tool.phase
    if (state.mood === 'idle') { state.mood = 'running'; state.activeSessions = 1 }
    state.navigation = { kind: 'task', targetRef: PREVIEW_TARGET }
  }
  if (typeof patch.phase === 'string' || patch.phase === null) {
    state.phase = patch.phase
    dirty = true
  }
  if (patch.team !== null && typeof patch.team === 'object') {
    state.team = {
      active: Number.isFinite(patch.team.active) ? Math.max(0, patch.team.active) : state.team.active,
      waiting: Number.isFinite(patch.team.waiting) ? Math.max(0, patch.team.waiting) : state.team.waiting,
      completed: Number.isFinite(patch.team.completed) ? Math.max(0, patch.team.completed) : state.team.completed,
      errors: Number.isFinite(patch.team.errors) ? Math.max(0, patch.team.errors) : state.team.errors,
      coordinating: typeof patch.team.coordinating === 'boolean' ? patch.team.coordinating : state.team.coordinating,
    }
    dirty = true
  }
  if (patch.toolError === null) {
    state.toolError = null
    dirty = true
  } else if (patch.toolError && typeof patch.toolError.id === 'string') {
    state.toolError = {
      id: patch.toolError.id,
      seq: Number.isFinite(patch.toolError.seq) ? patch.toolError.seq : 0,
    }
    dirty = true
  }
  if (patch.prefs !== null && typeof patch.prefs === 'object') {
    state.prefs = normalisePrefs({ ...state.prefs, ...patch.prefs })
    dirty = true
  }
  if (dirty) publish()
  return state
}

function json(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  })
  res.end(payload)
}

function file(res, path, type) {
  try {
    const body = readFileSync(path)
    res.writeHead(200, { 'content-type': type, 'content-length': body.length, 'cache-control': 'no-store' })
    res.end(body)
  } catch {
    res.writeHead(404)
    res.end()
  }
}

function readBody(req) {
  return new Promise((done) => {
    let raw = ''
    req.on('data', (chunk) => { raw += chunk; if (raw.length > 4096) req.destroy() })
    req.on('end', () => {
      try { done(JSON.parse(raw === '' ? '{}' : raw)) } catch { done({}) }
    })
    // A destroyed request never emits `end`; resolve so the route stops waiting.
    req.on('close', () => done({}))
  })
}

export const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://127.0.0.1:${port}`)
  const path = decodeURIComponent(url.pathname)

  if (req.method === 'GET' && path === '/') return file(res, join(root, 'preview/preview.html'), 'text/html; charset=utf-8')
  if (req.method === 'GET' && path === '/lib/client.js') return file(res, join(root, 'lib/client.js'), 'text/javascript; charset=utf-8')
  if (req.method === 'GET' && path === `${API}/atlas.png`) {
    return file(res, join(root, 'lib', 'skins', activeSkin(), DEFAULT_MANIFEST.sheets.base.file), 'image/png')
  }
  // The desktop page too, so a shell can be pointed at the playground:
  //   BigFatFishGirl --url http://127.0.0.1:41739/big-fat-fish-girl/v1/desktop
  if (req.method === 'GET' && path === `${API}/desktop`) return file(res, join(root, 'desktop/pet.html'), 'text/html; charset=utf-8')
  if (req.method === 'GET' && path === `${API}/manifest`) return json(res, 200, manifestForSkin(activeSkin()))
  if (req.method === 'GET' && path === `${API}/skins`) {
    return json(res, 200, listSkins().map(({ id, title }) => ({ id, title })))
  }
  if (req.method === 'GET' && path === `${API}/state`) return json(res, 200, state)

  if (req.method === 'GET' && path.startsWith(`${API}/skin/`)) {
    const rest = path.slice(`${API}/skin/`.length)
    const slash = rest.indexOf('/')
    const requested = slash === -1 ? '' : rest.slice(0, slash)
    const name = slash === -1 ? '' : rest.slice(slash + 1)
    const installed = listSkins().some((skin) => skin.id === requested)
    if (!installed || !SHEET_FILES.has(name)) { res.writeHead(404); return res.end() }
    return file(res, join(root, 'lib', 'skins', requested, name), 'image/png')
  }

  if (req.method === 'GET' && path.startsWith(`${API}/sheet/`)) {
    const name = path.slice(`${API}/sheet/`.length)
    if (!SHEET_FILES.has(name)) { res.writeHead(404); return res.end() }
    return file(res, join(root, 'lib', 'skins', activeSkin(), name), 'image/png')
  }

  if (req.method === 'GET' && path === `${API}/events`) {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    })
    res.write(`event: snapshot\ndata: ${JSON.stringify(state)}\n\n`)
    clients.add(res)
    const heartbeat = setInterval(() => res.write(': ping\n\n'), 20000)
    res.on('close', () => { clearInterval(heartbeat); clients.delete(res) })
    return
  }

  // The same navigation route the real host serves (the in-page contract of the
  // desktop page POSTs here). There are no in-page clients in the playground.
  if (req.method === 'POST' && path === `${API}/navigate`) {
    return json(res, 200, { ok: true })
  }

  // Development-only echo channel: the desktop page uses it to report what it can see
  // (for example during the Tauri shell prototype).
  if (req.method === 'POST' && path === `${API}/preview/log`) {
    const body = await readBody(req)
    console.log('preview log:', JSON.stringify(body))
    return json(res, 200, { ok: true })
  }

  // Preview-only control channel; the real host has no such route.
  if (req.method === 'POST' && path === `${API}/preview/state`) {
    return json(res, 200, patchState(await readBody(req)))
  }

  res.writeHead(404)
  res.end()
})

// Only listen when run directly: the tests import the server and manage the port.
const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  server.listen(port, '127.0.0.1', () => {
    console.log(`Big Fat Fish Girl preview: http://127.0.0.1:${port}`)
    console.log('Flip the state in the page — she reacts exactly as she does in Harness.')
  })
}

export { state }
