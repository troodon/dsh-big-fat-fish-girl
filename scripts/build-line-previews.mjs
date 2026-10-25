// Renders the pet's commentary as real frames: the bundle that ships runs in the preview
// playground inside a headless Chromium, this script drives it over the DevTools protocol
// (Node's built-in WebSocket — no dependency), and screenshots the pet where she stands.
//
// The phrase in each picture is the one the pet really picked, read back from the page and
// printed to the log, so a picture cannot show a line the plugin does not say. These are
// captures, not generated art: the same bundle, in a real browser, driven through the same
// preview control channel a contributor uses by hand.
//
//   node scripts/build-line-previews.mjs [--out docs/preview/captures/lines] [--port 41780] [--skin <id>]
//
// A Chromium binary is needed (CHROME_BIN); the first one installed that starts headless is
// used, because Chrome 119 cannot start headless on a current macOS.
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createServer } from 'node:net'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { linesFor, LOCALES } from '../lib/i18n/lines.mjs'
import { DEFAULT_SKIN } from '../lib/host/skins.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const flag = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? fallback : process.argv[index + 1]
}

const outDir = resolve(flag('out', 'docs/preview/captures/lines'))
const debugPort = Number(flag('debug-port', 9333))
const skin = flag('skin', DEFAULT_SKIN)
// Default 0 = "pick a free port". A fixed port that something else already holds makes the
// script talk to the wrong server and render the wrong thing, which is worse than failing.
const port = Number(flag('port', 0))

// Any Chromium will do; the first one that exists and can start headless on this machine
// is used, because Chrome 119 (still found on some macOS installs) cannot.
const BROWSERS = [
  process.env.CHROME_BIN,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
].filter((path) => typeof path === 'string' && path !== '' && existsSync(path))

// What to show, as data: each entry is one state on the preview control channel, the
// picture name, and the phrase pool the pet must be speaking from when the frame is taken
// (`lib/behavior/phases.mjs` holds the real phase→pool and mood→pool mapping). A mood that is
// transient on the wire (welcome, review, failed, limited) still renders — the frame is
// taken while it is on screen.
const scenes = [
  { file: 'welcome', state: { mood: 'welcome' }, pool: 'welcome' },
  { file: 'thinking', state: { mood: 'running', phase: 'processing' }, pool: 'working' },
  { file: 'composing', state: { mood: 'running', phase: 'composing' }, pool: 'writing' },
  { file: 'reading', state: { mood: 'running', tool: { phase: 'reading' } }, pool: 'reading' },
  { file: 'editing', state: { mood: 'running', tool: { phase: 'writing' } }, pool: 'editing' },
  { file: 'commanding', state: { mood: 'running', tool: { phase: 'commanding' } }, pool: 'commanding' },
  { file: 'browsing', state: { mood: 'running', tool: { phase: 'browsing' } }, pool: 'browsing' },
  { file: 'waiting', state: { mood: 'waiting' }, pool: 'waiting' },
  { file: 'done', state: { mood: 'review' }, pool: 'done' },
  { file: 'failed', state: { mood: 'failed' }, pool: 'failed' },
  { file: 'limited', state: { mood: 'limited' }, pool: 'limited' },
  // A quiet moment is a scene of its own: she says nothing at all, and the bubble hides.
  { file: 'idle', state: { mood: 'idle' }, pool: null },
]

// Derive previews from the supported locales so translations cannot be omitted here.
const locales = LOCALES

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

/** A free port from the OS, so this script can never fight a leftover process for one. */
function freePort() {
  return new Promise((done, fail) => {
    const probe = createServer()
    probe.once('error', fail)
    probe.listen(0, '127.0.0.1', () => {
      const { port: chosen } = probe.address()
      probe.close(() => done(chosen))
    })
  })
}

/**
 * Starts the preview playground and waits until it really answers, because a server that
 * died on a taken port would otherwise make every later step quietly wrong.
 */
async function startPreviewServer(chosenPort) {
  const child = spawn(process.execPath,
    [join(root, 'preview', 'server.mjs'), '--port', String(chosenPort)], { cwd: root, stdio: 'ignore' })
  child.once('exit', (code) => {
    if (code !== 0 && code !== null) console.error(`preview server exited with ${code}`)
  })
  const url = `http://127.0.0.1:${chosenPort}/big-fat-fish-girl/v1/state`
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(url)
      if (response.ok) return child
    } catch { /* not up yet */ }
    await sleep(100)
  }
  child.kill()
  throw new Error(`the preview server never answered on ${url}`)
}

const getJson = async (url, budgetMs = 8000) => {
  const deadline = Date.now() + budgetMs
  for (;;) {
    try {
      const response = await fetch(url)
      if (response.ok) return await response.json()
    } catch { /* not up yet */ }
    if (Date.now() >= deadline) throw new Error(`no response from ${url} within ${budgetMs}ms`)
    await sleep(100)
  }
}

/**
 * Chromium builds differ in whether they can still start headless (Chrome 119 cannot, on
 * a current macOS), so each candidate gets its own short probe instead of a fixed default —
 * and its own profile directory, because a crashed browser leaves a lock behind.
 */
async function startBrowser(previewUrl) {
  const problems = []
  for (const candidate of BROWSERS) {
    const profile = join(mkdtempSync(join(tmpdir(), 'bffg-browser-')), 'profile')
    const browser = spawn(candidate, [
      '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      '--hide-scrollbars', '--force-device-scale-factor=1', '--window-size=820,640',
      `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, previewUrl,
    ], { stdio: 'ignore' })
    browser.once('exit', () => rmSync(profile, { recursive: true, force: true, maxRetries: 2 }))
    try {
      await getJson(`http://127.0.0.1:${debugPort}/json/version`, 15000)
      return { browser, path: candidate }
    } catch (error) {
      browser.kill('SIGKILL')
      problems.push(`${candidate.split('/').slice(-2).join('/')}: ${error.message}`)
    }
  }
  throw new Error(`no Chromium could start headless — set CHROME_BIN\n  ${problems.join('\n  ')}`)
}

/** One DevTools call, answered by id. Events without an id are ignored. */
function devtools(socket) {
  let next = 1
  const waiting = new Map()
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    const settle = waiting.get(message.id)
    if (settle === undefined) return
    waiting.delete(message.id)
    if (message.error !== undefined) settle.reject(new Error(message.error.message))
    else settle.resolve(message.result)
  })
  return (method, params = {}) => new Promise((resolveCall, rejectCall) => {
    const id = next
    next += 1
    waiting.set(id, { resolve: resolveCall, reject: rejectCall })
    socket.send(JSON.stringify({ id, method, params }))
  })
}

/** The pet's box, her current line and the animation she is playing, read back from the page. */
const READ_BACK = `(() => {
  const host = document.querySelector('[data-bffg]')
  const bubble = host?.querySelector('.bffg-status')
  const box = host?.getBoundingClientRect()
  const bubbleBox = bubble && !bubble.hidden ? bubble.getBoundingClientRect() : null
  const left = Math.max(0, Math.floor(Math.min(box?.left ?? 0, bubbleBox?.left ?? box?.left ?? 0) - 8))
  const top = Math.max(0, Math.floor(Math.min(box?.top ?? 0, bubbleBox?.top ?? box?.top ?? 0) - 8))
  const right = Math.min(window.innerWidth, Math.ceil(Math.max(box?.right ?? 0, bubbleBox?.right ?? box?.right ?? 0) + 8))
  const bottom = Math.min(window.innerHeight, Math.ceil(Math.max(box?.bottom ?? 0, bubbleBox?.bottom ?? box?.bottom ?? 0) + 8))
  return JSON.stringify({
    ready: Boolean(host?.querySelector('canvas')?.width),
    text: bubble?.hidden === true ? '' : (bubble?.textContent ?? ''),
    tone: bubble?.dataset.tone ?? '',
    act: host?.dataset.mood ?? '',
    clip: { x: left, y: top, width: right - left, height: bottom - top },
  })
})()`

async function readBack(evaluate) {
  return JSON.parse(await evaluate(READ_BACK))
}

/**
 * Waits until the pet is really in the requested state: she either says a line from that
 * scene's pool (the plugin's own pools, so the pool names cannot drift from the code), or
 * says nothing at all when the scene is the quiet one. Without this, a frame taken while
 * the previous line is still on screen looks perfectly plausible and says the wrong thing.
 */
async function waitForScene(evaluate, locale, scene) {
  const silent = scene.pool === null
  const expected = silent ? null : new Set(linesFor(locale, scene.pool))
  let last = null
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const state = await readBack(evaluate)
    if (state.ready) {
      last = state
      // `text` is empty exactly while the bubble is hidden, which is what idle looks like.
      if (silent ? state.text === '' : expected.has(state.text)) return state
    }
    await sleep(100)
  }
  throw new Error(silent
    ? 'the pet never went quiet'
    : `the pet never spoke from the "${scene.pool}" pool (last line: ${JSON.stringify(last?.text ?? null)})`)
}

/** One state POST, shared by the scene captures and the per-locale setup. */
async function postState(port, patch) {
  const response = await fetch(`http://127.0.0.1:${port}/big-fat-fish-girl/v1/preview/state`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  })
  if (!response.ok) throw new Error(`preview state rejected: ${response.status}`)
}

/**
 * A scene's patch. The control channel keeps a tool open until it is explicitly closed,
 * so every scene must say `tool: null` unless it uses one — otherwise the previous scene's
 * tool leaks into the next picture and the pet keeps talking about it.
 */
const patchFor = (scene, locale) => ({
  mood: 'idle',
  tool: null,
  ...scene.state,
  prefs: { locale, skin },
})

/** Waits for the pet to mount and decode the base atlas after a page load. */
async function waitForMount(evaluate) {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    const state = await readBack(evaluate)
    if (state.ready) return state
    await sleep(100)
  }
  throw new Error('the pet never mounted after the page load')
}

async function capture(scene, locale, dir, page, port) {
  await postState(port, patchFor(scene, locale))
  const state = await waitForScene(page.evaluate, locale, scene)
  // The bubble pops in over 180ms; give it that, and the canvas its next frame.
  await sleep(300)
  const shot = await page.call('Page.captureScreenshot', {
    format: 'png', captureBeyondViewport: false,
    clip: { ...state.clip, scale: 1 },
  })
  writeFileSync(join(dir, `${scene.file}.png`), Buffer.from(shot.data, 'base64'))
  const said = state.text === '' ? '(quiet)' : `"${state.text}"`
  const amber = state.text !== '' && state.tone === 'alert' ? '  (amber)' : ''
  console.log(`  ${scene.file}: ${said}${amber}`)
}

async function main() {
  if (BROWSERS.length === 0) {
    throw new Error('no Chromium found — set CHROME_BIN to a Chrome, Edge or Chromium binary')
  }
  rmSync(outDir, { recursive: true, force: true })
  const chosenPort = port === 0 ? await freePort() : port
  const preview = `http://127.0.0.1:${chosenPort}/`
  const server = await startPreviewServer(chosenPort)
  const { browser, path: browserPath } = await startBrowser(preview)

  const cleanup = () => {
    browser.kill('SIGKILL')
    server.kill()
  }
  process.on('exit', cleanup)

  try {
    const targets = await getJson(`http://127.0.0.1:${debugPort}/json/list`)
    // Extension background pages show up in the same list; the page is the one we opened.
    const target = targets.find((entry) => entry.type === 'page' && entry.url.startsWith(preview))
      ?? targets.find((entry) => entry.type === 'page')
    if (target === undefined) throw new Error('the browser opened no page')
    console.log(`rendering with ${browserPath.split('/').slice(-2).join('/')}`)
    const socket = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise((done, fail) => {
      socket.addEventListener('open', done, { once: true })
      socket.addEventListener('error', () => fail(new Error('cannot talk to the browser')), { once: true })
    })
    const call = devtools(socket)
    await call('Runtime.enable')
    await call('Page.enable')
    const evaluate = (expression) => call('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise: true,
    }).then((result) => result.result.value)
    const page = { call, evaluate }

    for (const locale of locales) {
      const dir = join(outDir, locale)
      mkdirSync(dir, { recursive: true })
      // Set the language on the server and start from a clean page. A client that has
      // been through the other locale's scenes still carries the line it was showing,
      // and it holds that line until it expires — a fresh page has nothing to hold.
      await postState(chosenPort, patchFor({ state: {} }, locale))
      await call('Page.reload')
      await waitForMount(evaluate)
      console.log(`\n${locale} phrases:`)
      for (const scene of scenes) await capture(scene, locale, dir, page, chosenPort)
    }
    console.log(`\nwrote ${outDir}`)
  } finally {
    cleanup()
  }
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
