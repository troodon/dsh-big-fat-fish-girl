import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { apply } from '../lib/host/index.mjs'
import { SHEET_ASSET_REVISIONS } from '../lib/animation/sheet-revisions.mjs'
import { DEFAULT_SKIN } from '../lib/settings/prefs.mjs'

function response() {
  return {
    status: 0,
    headers: {},
    body: undefined,
    writes: [],
    writeHead(status, headers = {}) { this.status = status; this.headers = headers },
    end(body) { this.body = body },
    write(chunk) { this.writes.push(chunk); return true },
    flushHeaders() {},
    once(_event, listener) { this.onClose = listener },
  }
}

test('registers read-only state, SSE, and atlas routes; live events update the snapshot', () => {
  const routes = new Map()
  const listeners = new Map()
  const cleanups = []
  const ctx = {
    get(name) {
      if (name === 'sessions') return { list: () => [] }
      if (name === 'webServer') return {
        register(route) {
          routes.set(route.path, route)
          return () => routes.delete(route.path)
        },
      }
    },
    on(name, callback) {
      listeners.set(name, callback)
      return () => listeners.delete(name)
    },
    effect(setup) { cleanups.push(setup()) },
  }
  apply(ctx)
  assert.equal(routes.size, 9, 'state, SSE, atlas, manifest, sheets, skins, skin, desktop, navigate')
  assert.ok(routes.has('/big-fat-fish-girl/v1/manifest'))
  assert.ok(routes.has('/big-fat-fish-girl/v1/desktop'))
  assert.ok(routes.has('/big-fat-fish-girl/v1/navigate'))
  // Регресс: роутер DSH матчит prefix как `${path}/…`, поэтому завершающего слэша
  // в зарегистрированном пути быть не должно — иначе маршрут не совпадает вообще.
  assert.ok(routes.has('/big-fat-fish-girl/v1/sheet'), 'prefix без завершающего слэша')
  assert.ok(routes.has('/big-fat-fish-girl/v1/skin'), 'префикс скинов без завершающего слэша')
  assert.ok(routes.has('/big-fat-fish-girl/v1/skins'))
  assert.equal(routes.has('/big-fat-fish-girl/v1/sheet/'), false)
  assert.equal(listeners.has('session/event'), true)

  const stateRoute = routes.get('/big-fat-fish-girl/v1/state')
  const idle = response()
  stateRoute.handler({ method: 'GET' }, idle)
  assert.equal(idle.status, 200)
  assert.equal(JSON.parse(idle.body).mood, 'idle')
  // Настройки плагина публикуются вместе со снимком: страница берёт их оттуда.
  const idlePrefs = JSON.parse(idle.body).prefs
  assert.equal(idlePrefs.size, 132, 'дефолтный размер')
  assert.equal(idlePrefs.locale, 'en')
  // Пока оболочки нет, встроенный пет не скрывается.
  assert.equal(JSON.parse(idle.body).shellActive, false)

  listeners.get('session/event')({ id: 'session-1' }, { type: 'turn/start', data: {} })
  const running = response()
  stateRoute.handler({ method: 'GET' }, running)
  const body = JSON.parse(running.body)
  assert.equal(body.mood, 'welcome')
  assert.equal(body.apiVersion, 3)
  assert.equal(body.activeSessions, 1)
  // Приватность: только непрозрачная цель навигации, без имён и содержимого.
  assert.equal(body.navigation.targetRef, 'session-1')
  assert.equal(JSON.stringify(body).includes('session-1'), true, 'id нужен для клика')
  assert.equal(JSON.stringify(body).includes('read_file'), false)
  listeners.get('session/event')({ id: 'session-1' }, { type: 'message/delta', data: { text: 'private response' } })
  const afterPrivateEvent = response()
  stateRoute.handler({ method: 'GET' }, afterPrivateEvent)
  assert.equal(JSON.parse(afterPrivateEvent.body).mood, 'welcome')
  assert.equal(afterPrivateEvent.body.includes('private response'), false)

  const denied = response()
  stateRoute.handler({ method: 'POST' }, denied)
  assert.equal(denied.status, 405)

  const image = response()
  routes.get('/big-fat-fish-girl/v1/atlas.png').handler({ method: 'GET' }, image)
  assert.equal(image.status, 200)
  assert.equal(image.headers['content-type'], 'image/png')
  assert.deepEqual(image.body, readFileSync(new URL(`../lib/skins/${DEFAULT_SKIN}/spritesheet.png`, import.meta.url)))

  const manifest = response()
  routes.get('/big-fat-fish-girl/v1/manifest').handler({ method: 'GET' }, manifest)
  assert.equal(JSON.parse(manifest.body).sheets.base.url,
    `/big-fat-fish-girl/v1/skin/${DEFAULT_SKIN}/spritesheet.png?v=${SHEET_ASSET_REVISIONS[DEFAULT_SKIN]['spritesheet.png']}`,
    'манифест несёт URL активного скина с хэшем атласа')

  for (const cleanup of cleanups.reverse()) cleanup()
  assert.equal(routes.size, 0)
  assert.equal(listeners.size, 0)
})

test('SSE sends an immediate compact snapshot and closes cleanly', () => {
  const routes = new Map()
  let onEvent
  let cleanup
  const ctx = {
    get(name) {
      if (name === 'sessions') return { list: () => [] }
      if (name === 'webServer') return { register: (route) => { routes.set(route.path, route); return () => routes.delete(route.path) } }
    },
    on(_name, callback) { onEvent = callback; return () => { onEvent = null } },
    effect(setup) { cleanup = setup() },
  }
  apply(ctx)
  const res = response()
  routes.get('/big-fat-fish-girl/v1/events').handler({ method: 'GET' }, res)
  assert.equal(res.status, 200)
  assert.ok(res.headers['content-type'].startsWith('text/event-stream'))
  assert.ok(res.writes.join('').includes('event: snapshot'))
  assert.ok(res.writes.join('').includes('"mood":"idle"'))
  const writeCount = res.writes.length
  onEvent({ id: 's2' }, { type: 'message/delta', data: { text: 'private response' } })
  assert.equal(res.writes.length, writeCount)
  onEvent({ id: 's2' }, { type: 'turn/start', data: {} })
  assert.ok(res.writes.join('').includes('"mood":"welcome"'))
  res.onClose()
  cleanup()
  assert.equal(routes.size, 0)
})

test('клиент десктоп-оболочки помечает снимок shellActive и прячет встроенного пета', () => {
  const routes = new Map()
  let cleanup
  const ctx = {
    get(name) {
      if (name === 'sessions') return { list: () => [] }
      if (name === 'webServer') {
        return { register: (route) => { routes.set(route.path, route); return () => routes.delete(route.path) } }
      }
    },
    on() { return () => {} },
    effect(setup) { cleanup = setup() },
  }
  apply(ctx)
  const shell = response()
  routes.get('/big-fat-fish-girl/v1/events').handler(
    { method: 'GET', url: '/big-fat-fish-girl/v1/events?surface=desktop' },
    shell,
  )
  assert.ok(shell.writes.join('').includes('"shellActive":true'), 'первый же снимок видит оболочку')
  const state = response()
  routes.get('/big-fat-fish-girl/v1/state').handler({ method: 'GET' }, state)
  assert.equal(JSON.parse(state.body).shellActive, true)
  shell.onClose()
  cleanup()
  assert.equal(routes.size, 0)
})

test('sheet route serves whitelisted sheets and refuses everything else', () => {
  const routes = new Map()
  const ctx = {
    get(name) {
      if (name === 'sessions') return { list: () => [] }
      if (name === 'webServer') {
        return { register(route) { routes.set(route.path, route); return () => routes.delete(route.path) } }
      }
    },
    on() { return () => {} },
    effect(setup) { return setup() },
  }
  apply(ctx)
  const route = routes.get('/big-fat-fish-girl/v1/sheet')
  assert.ok(route, 'маршрут листов зарегистрирован')

  const ok = response()
  route.handler({ method: 'GET', url: '/big-fat-fish-girl/v1/sheet/spritesheet.png' }, ok)
  assert.equal(ok.status, 200)
  assert.equal(ok.headers['content-type'], 'image/png')
  assert.ok(ok.body.length > 1000, 'PNG действительно отдан')

  const head = response()
  route.handler({ method: 'HEAD', url: '/big-fat-fish-girl/v1/sheet/spritesheet.png' }, head)
  assert.equal(head.status, 200)
  assert.equal(head.body, undefined, 'HEAD без тела')

  for (const url of [
    '/big-fat-fish-girl/v1/sheet/../package.json',
    '/big-fat-fish-girl/v1/sheet/%2e%2e/package.json',
    '/big-fat-fish-girl/v1/sheet/lib/index.mjs',
    '/big-fat-fish-girl/v1/sheet/',
  ]) {
    const denied = response()
    route.handler({ method: 'GET', url }, denied)
    assert.equal(denied.status, 404, `должно быть 404: ${url}`)
  }

  const wrongMethod = response()
  route.handler({ method: 'POST', url: '/big-fat-fish-girl/v1/sheet/spritesheet.png' }, wrongMethod)
  assert.equal(wrongMethod.status, 405)
})

test('skin routes list the installed skins and never leave the skins folder', () => {
  const routes = new Map()
  const ctx = {
    get(name) {
      if (name === 'sessions') return { list: () => [] }
      if (name === 'webServer') {
        return { register(route) { routes.set(route.path, route); return () => routes.delete(route.path) } }
      }
    },
    on() { return () => {} },
    effect(setup) { return setup() },
  }
  apply(ctx)

  const list = response()
  routes.get('/big-fat-fish-girl/v1/skins').handler({ method: 'GET' }, list)
  const skins = JSON.parse(list.body)
  assert.deepEqual(skins.map((skin) => skin.id), ['deepseek-chan'])
  assert.equal(skins[0].title, 'DeepSeek Chan (Big Fat Fish Girl)')

  const route = routes.get('/big-fat-fish-girl/v1/skin')
  const ok = response()
  route.handler({ method: 'GET', url: '/big-fat-fish-girl/v1/skin/deepseek-chan/spritesheet.png' }, ok)
  assert.equal(ok.status, 200)
  assert.equal(ok.headers['content-type'], 'image/png')
  assert.ok(ok.body.length > 1000, 'PNG действительно отдан')

  for (const url of [
    '/big-fat-fish-girl/v1/skin/nope/spritesheet.png',
    '/big-fat-fish-girl/v1/skin/deepseek-chan/../skin.json',
    '/big-fat-fish-girl/v1/skin/deepseek-chan/lib/index.mjs',
    '/big-fat-fish-girl/v1/skin/deepseek-chan/',
  ]) {
    const denied = response()
    route.handler({ method: 'GET', url }, denied)
    assert.equal(denied.status, 404, `должно быть 404: ${url}`)
  }

  const wrongMethod = response()
  route.handler({ method: 'POST', url: '/big-fat-fish-girl/v1/skin/deepseek-chan/spritesheet.png' }, wrongMethod)
  assert.equal(wrongMethod.status, 405)
})

test('desktop route serves a self-contained page for a native shell', () => {
  const routes = new Map()
  const ctx = {
    get(name) {
      if (name === 'sessions') return { list: () => [] }
      if (name === 'webServer') {
        return { register(route) { routes.set(route.path, route); return () => routes.delete(route.path) } }
      }
    },
    on() { return () => {} },
    effect(setup) { return setup() },
  }
  apply(ctx)
  const route = routes.get('/big-fat-fish-girl/v1/desktop')
  assert.ok(route, 'маршрут страницы оболочки зарегистрирован')

  const ok = response()
  route.handler({ method: 'GET', url: '/big-fat-fish-girl/v1/desktop' }, ok)
  assert.equal(ok.status, 200)
  assert.match(ok.headers['content-type'], /text\/html/)
  const page = String(ok.body)
  assert.ok(page.includes('__BFFG_SHELL__'), 'в странице описан контракт оболочки')
  assert.deepEqual(page.match(/<(?:script|link)[^>]*(?:src|href)=/gi) ?? [], [], 'никаких внешних ссылок')

  const wrongMethod = response()
  route.handler({ method: 'POST', url: '/big-fat-fish-girl/v1/desktop' }, wrongMethod)
  assert.equal(wrongMethod.status, 405)
})

test('cold start replays session.log (0.2.0 shape) instead of pretending to be idle', () => {
  const routes = new Map()
  const ctx = {
    get(name) {
      if (name === 'sessions') {
        return {
          list: () => [{
            id: 's1',
            header: { id: 's1', isSeeded: false },
            log: [
              { type: 'turn/start', data: { turn: 1 } },
              { type: 'tool/call', data: { callId: 'c1', name: 'bash' } },
              { type: 'approval/asked', data: { id: 'a1', toolName: 'bash' } },
            ],
          }],
        }
      }
      if (name === 'webServer') {
        return { register(route) { routes.set(route.path, route); return () => routes.delete(route.path) } }
      }
    },
    on() { return () => {} },
    effect(setup) { return setup() },
  }
  apply(ctx)
  const res = response()
  routes.get('/big-fat-fish-girl/v1/state').handler({ method: 'GET' }, res)
  const body = JSON.parse(res.body)
  assert.equal(body.apiVersion, 3)
  assert.equal(body.mood, 'waiting', 'открытое разрешение переживает холодный старт')
  assert.equal(body.attention.targetRef, 's1')
  assert.equal(body.tool.phase, 'commanding')
})

test('a session list that cannot be read is reported, and the pet still starts', (t) => {
  const warnings = []
  t.mock.method(console, 'warn', (...args) => warnings.push(args.join(' ')))
  const cleanups = []
  const ctx = {
    get(name) {
      if (name === 'sessions') return { list: () => { throw new Error('boom') } }
    },
    on() { return () => {} },
    effect(setup) { cleanups.push(setup()) },
  }
  apply(ctx)
  assert.deepEqual(warnings, ['big-fat-fish-girl: could not replay live sessions: boom'])
  for (const cleanup of cleanups.reverse()) cleanup()
})

test('navigate accepts only currently open refs and reaches SSE clients', async () => {
  const routes = new Map()
  let onEvent
  const cleanups = []
  const ctx = {
    get(name) {
      if (name === 'sessions') return { list: () => [] }
      if (name === 'webServer') {
        return { register(route) { routes.set(route.path, route); return () => routes.delete(route.path) } }
      }
    },
    on(_name, callback) { onEvent = callback; return () => { onEvent = null } },
    effect(setup) { cleanups.push(setup()) },
  }
  apply(ctx)
  const navigate = routes.get('/big-fat-fish-girl/v1/navigate')
  const events = routes.get('/big-fat-fish-girl/v1/events')
  const body = (value, contentType = 'application/json') => ({
    method: 'POST',
    headers: { 'content-type': contentType },
    on(event, fn) {
      if (event === 'data') fn(JSON.stringify(value))
      if (event === 'end') fn()
      return this
    },
  })

  const sse = response()
  events.handler({ method: 'GET' }, sse)
  onEvent({ id: 's1' }, { type: 'approval/asked', data: { id: 'a1' } })

  const missing = response()
  await navigate.handler(body({}), missing)
  assert.equal(missing.status, 400)

  const unknown = response()
  await navigate.handler(body({ targetRef: 'nope' }), unknown)
  assert.equal(unknown.status, 409, 'произвольная цель не проходит allow-list')

  const ok = response()
  await navigate.handler(body({ targetRef: 's1' }), ok)
  assert.equal(ok.status, 200)
  assert.ok(sse.writes.join('').includes('event: navigate'), 'клиенты получили команду')
  assert.ok(sse.writes.join('').includes('s1'))

  const wrongMethod = response()
  await navigate.handler({ method: 'GET' }, wrongMethod)
  assert.equal(wrongMethod.status, 405)

  const plainText = response()
  await navigate.handler(body({ targetRef: 's1' }, 'text/plain'), plainText)
  assert.equal(plainText.status, 415, 'a plain-text POST from another page does not navigate')

  for (const cleanup of cleanups.reverse()) cleanup()
})
