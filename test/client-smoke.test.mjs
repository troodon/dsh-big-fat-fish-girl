// End-to-end smoke test for the browser bundle in a real DOM (jsdom).
//
// This is the regression net for the two failures that shipped: the pet mounting
// before <body> existed (silently doing nothing) and the overlay not being anchored
// to the viewport. Both are cheap to catch here and expensive to catch in DSH.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

// jsdom is a development-only dependency: the published package stays dependency-free,
// so the smoke test skips itself (with a readable reason) where it is not installed.
let JSDOM = null
try {
  ({ JSDOM } = await import('jsdom'))
} catch {
  JSDOM = null
}

const BUNDLE = new URL('../lib/client.js', import.meta.url)
const source = existsSync(BUNDLE) ? readFileSync(BUNDLE, 'utf8') : null
const skip = JSDOM === null
  ? 'jsdom не установлен — smoke-тест пропущен (npm i -D jsdom)'
  : source === null
    ? 'lib/client.js не собран — сначала node scripts/build-client.mjs'
    : false

const HOVER_ACTS = new Set(['wave', 'jump'])

function harness({ withBody = true, recordImages = false, debug = true } = {}) {
  const dom = new JSDOM('<!doctype html><html><head></head><body><div id="root"></div></body></html>', {
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    url: 'http://127.0.0.1:19387/',
  })
  const { window } = dom
  // jsdom has no canvas backend; the pet must survive a null 2D context.
  window.HTMLCanvasElement.prototype.getContext = () => null
  window.fetch = async () => ({
    ok: true,
    json: async () => ({ apiVersion: 1, mood: 'idle', activeSessions: 0, until: 0 }),
  })
  window.EventSource = class { constructor() {} addEventListener() {} close() {} }
  // Считаем, какие листы страница вообще просила: ленивость проверяется именно этим.
  const requested = []
  if (recordImages) {
    window.Image = class {
      constructor() { this.listeners = {}; this.decoding = '' }
      addEventListener(type, listener) { (this.listeners[type] ??= []).push(listener) }
      set src(value) { this._src = value; requested.push(String(value)); queueMicrotask(() => (this.listeners.load ?? []).forEach((fn) => fn())) }
      get src() { return this._src }
    }
  }

  const errors = []
  window.addEventListener('error', (event) => errors.push(String(event.message || event)))
  window.addEventListener('unhandledrejection', (event) => errors.push(String(event.reason)))

  let registered = null
  window.__ModuleLoader__ = { load: (registration) => { registered = registration } }

  const realBody = window.document.body
  if (!withBody) Object.defineProperty(window.document, 'body', { configurable: true, get: () => null })

  window.__BFFG_DEBUG_ENABLED__ = debug
  window.eval(source)
  const mod = registered.factory(() => {})
  let dispose = null
  return {
    window,
    document: window.document,
    errors,
    mod,
    apply() { dispose = mod.apply(); return dispose },
    restoreBody() {
      if (withBody) return
      Object.defineProperty(window.document, 'body', { configurable: true, value: realBody, writable: true })
      window.document.dispatchEvent(new window.Event('DOMContentLoaded', { bubbles: true }))
    },
    host: () => window.document.querySelector('[data-bffg]'),
    requested,
    cleanup() {
      if (typeof dispose === 'function') dispose()
      dispose = null
      window.close()
    },
  }
}

test('бандл регистрируется под именем пакета и экспортирует apply', { skip }, () => {
  const h = harness()
  assert.equal(h.mod.name, 'big-fat-fish-girl')
  assert.equal(typeof h.mod.apply, 'function')
  h.cleanup()
})

test('монтируется, если <body> уже существует', { skip }, () => {
  const h = harness()
  h.apply()
  const host = h.host()
  assert.ok(host, 'питомец должен быть в DOM')
  assert.equal(host.dataset.sheet, 'base')
  assert.equal(typeof host.dataset.mood, 'string')
  assert.deepEqual(h.errors, [])
  h.cleanup()
})

test('a settings change keeps the pet where the user left it (regression)', { skip }, () => {
  const h = harness()
  h.apply()
  const host = h.host()
  // A drag leaves the element and the saved position in agreement.
  host.style.left = '300px'
  host.style.top = '200px'
  h.window.localStorage.setItem('big-fat-fish-girl:position:v1', JSON.stringify({ x: 300, y: 200 }))
  h.window.__BFFG_DEBUG__.applySnapshot({
    mood: 'idle', activeSessions: 0, until: 0, revision: 1, shellActive: false, usage: null,
    prefs: { size: 132, opacity: 0.8, reducedMotion: false, hover: true, randomActs: true, meal: true, wallet: true, wander: true, locale: 'ru', skin: 'deepseek-chan' },
  }, true)
  assert.equal(host.style.left, '300px', 'an opacity change must not send the pet back to its corner')
  assert.equal(host.style.top, '200px')
  assert.deepEqual(JSON.parse(h.window.localStorage.getItem('big-fat-fish-girl:position:v1')), { x: 300, y: 200 })
  h.cleanup()
})

test('a production page exposes no debug surface; a test that opts in gets one', { skip }, () => {
  const closed = harness({ debug: false })
  closed.apply()
  assert.equal(closed.window.__BFFG_DEBUG__, undefined, 'the engine is out of reach unless a test asks for it')
  closed.cleanup()
  const open = harness()
  open.apply()
  assert.equal(typeof open.window.__BFFG_DEBUG__.engine, 'object')
  open.cleanup()
})

test('НЕ молчит, если модуль применён до появления <body> (регресс)', { skip }, () => {
  const h = harness({ withBody: false })
  h.apply()
  assert.equal(h.host(), null, 'до появления body монтировать некуда')
  h.restoreBody()
  assert.ok(h.host(), 'после DOMContentLoaded питомец обязан смонтироваться')
  assert.deepEqual(h.errors, [])
  h.cleanup()
})

test('при появлении питомец не спит (регресс: таймер сна стартовал с нуля)', { skip }, (t) => {
  const h = harness()
  t.after(() => h.cleanup())
  h.apply()
  const debug = h.window.__BFFG_DEBUG__
  assert.equal(debug.engine.isSleeping(), false, 'сразу после монтирования она бодрствует')
  h.cleanup
  t.after(() => h.cleanup())
})

test('оверлей привязан к правому нижнему углу по умолчанию', { skip }, () => {
  const h = harness()
  h.apply()
  const host = h.host()
  // CSS-якорь обязателен: fixed без координат встаёт в статическую позицию и уезжает под экран.
  assert.equal(host.style.right, '16px')
  assert.equal(host.style.bottom, '12px')
  h.cleanup()
})

test('наведение вызывает случайную выходку и текст-реакцию', { skip }, () => {
  const h = harness()
  h.apply()
  const stage = h.host().querySelector('.bffg-stage')
  assert.ok(stage, 'нужна зона наведения')
  stage.dispatchEvent(new h.window.Event('pointerenter', { bubbles: true }))
  const mood = h.host().dataset.mood
  assert.ok(HOVER_ACTS.has(mood), `ожидалась игровая реакция, получено "${mood}"`)
  const bubble = h.host().querySelector('.bffg-status')
  assert.ok((bubble.textContent ?? '').length > 0, 'на наведение должен быть текст')
  assert.deepEqual(h.errors, [])
  h.cleanup()
})

test('настройки приходят из снимка и применяются; своей панели у питомца нет', { skip }, (t) => {
  const h = harness()
  t.after(() => h.cleanup())
  h.apply()
  const host = h.host()
  const debug = h.window.__BFFG_DEBUG__
  assert.equal(host.querySelector('.bffg-panel'), null, 'панель настроек убрана из питомца')
  debug.applySnapshot({
    mood: 'waiting', activeSessions: 0, until: 0,
    prefs: { size: 96, opacity: 0.5, reducedMotion: true, locale: 'zh-CN' },
  }, true)
  assert.equal(host.style.getPropertyValue('--bffg-size'), '96px', 'размер из настроек')
  assert.equal(host.style.getPropertyValue('--bffg-canvas-side'), '128px', 'квадратный холст сохраняет масштаб')
  assert.equal(host.style.getPropertyValue('--bffg-canvas-left'), '-16px', 'ось тела остаётся на прежнем X')
  assert.equal(host.style.opacity, '0.5', 'прозрачность из настроек')
  assert.equal(host.dataset.reduced, 'true', 'reduced motion из настроек')
  assert.equal(debug.getPrefs().locale, 'zh-CN', 'язык из настроек')
  assert.equal(host.querySelector('.bffg-status').textContent, '等你哦', 'китайская фраза приходит из собранного клиента')
  assert.deepEqual(h.errors, [])
})

test('dispose убирает питомца из страницы', { skip }, () => {
  const h = harness()
  const dispose = h.apply()
  assert.ok(h.host())
  assert.equal(typeof dispose, 'function')
  h.cleanup()
  assert.equal(h.host(), null)
})

test('повторное применение не создаёт второго питомца', { skip }, () => {
  const h = harness()
  h.apply()
  h.mod.apply()
  assert.equal(h.document.querySelectorAll('[data-bffg]').length, 1)
  h.cleanup()
})

test('питомец сам гуляет по своей линии и не выходит за окно', { skip }, (t) => {
  const h = harness()
  t.after(() => h.cleanup())
  h.apply()
  const host = h.host()
  const debug = h.window.__BFFG_DEBUG__
  assert.ok(debug, 'отладочный шов должен быть доступен')
  debug.setWander(true)

  // Прогулки теперь редкие (раз в 20–40 минут) — просим одну немедленно.
  const base = Date.now() + 30000
  debug.forceStroll(base)
  let moved = 0
  for (let i = 0; i < 60; i += 1) {
    const move = debug.applyWander(base + i * 100, 'idle')
    if (move && move.walking) moved += Math.abs(move.dx)
  }
  assert.ok(moved > 0, 'за 6 секунд простоя питомец обязан пройти хоть какое-то расстояние')

  const left = Number.parseFloat(host.style.left)
  assert.ok(Number.isFinite(left), 'позиция выставляется через left')
  assert.ok(left >= 8 && left <= h.window.innerWidth, `не выходит за окно (left=${left})`)
  assert.ok(['true', 'false'].includes(host.dataset.walking ?? 'false'), 'состояние ходьбы видно в DOM')
  assert.deepEqual(h.errors, [])
})

test('выключенные прогулки: питомец стоит на месте', { skip }, (t) => {
  const h = harness()
  t.after(() => h.cleanup())
  h.apply()
  const host = h.host()
  const debug = h.window.__BFFG_DEBUG__
  debug.setWander(false)
  const base = Date.now() + 30000
  for (let i = 1; i <= 40; i += 1) debug.applyWander(base + i * 100, 'idle')
  assert.equal(host.style.left, '', 'без прогулок позиция не назначается')
  assert.equal(host.dataset.walking, 'false')
  assert.deepEqual(h.errors, [])
})

test('во время работы питомец не гуляет', { skip }, (t) => {
  const h = harness()
  t.after(() => h.cleanup())
  h.apply()
  const host = h.host()
  const debug = h.window.__BFFG_DEBUG__
  debug.setWander(true)
  debug.applySnapshot({ mood: 'running', activeSessions: 1, until: 0 }, true)
  const base = Date.now() + 30000
  const moves = []
  for (let i = 1; i <= 40; i += 1) moves.push(debug.applyWander(base + i * 100))
  assert.ok(moves.every((move) => move === null), 'на работе прогулки не запускаются')
  assert.equal(host.style.left, '')
})

test('прогулка не обрывается о собственную анимацию: шаги идут подряд (регресс)', { skip }, (t) => {
  const h = harness()
  t.after(() => h.cleanup())
  h.apply()
  const debug = h.window.__BFFG_DEBUG__
  debug.setWander(true)
  const base = Date.now() + 30000
  debug.forceStroll(base)
  // Раньше гейт «тихо» смотрел на нарисованный кадр: первый же шаг делал состояние
  // runLeft/runRight, прогулка останавливалась и получался одиночный рывок.
  const steps = []
  for (let i = 1; i <= 12; i += 1) steps.push(debug.applyWander(base + i * 100))
  const walking = steps.filter((move) => move && move.walking)
  assert.ok(walking.length >= 8, `ожидалась непрерывная ходьба, получено ${JSON.stringify(steps)}`)
  const moved = walking.reduce((sum, move) => sum + Math.abs(move.dx), 0)
  assert.ok(moved > 20, `за 1,2 с она должна пройти заметное расстояние (${moved} px)`)
  assert.deepEqual(h.errors, [])
})

test('вызов инструмента: своя поза, а ожидание пользователя не перебивается', { skip }, (t) => {
  const h = harness()
  t.after(() => h.cleanup())
  h.apply()
  const debug = h.window.__BFFG_DEBUG__
  const now = Date.now()
  const base = { mood: 'running', activeSessions: 1, until: 0 }

  debug.applySnapshot({ ...base, tool: { phase: 'commanding', until: 0, seq: 1, open: true } }, true)
  const toolStart = debug.engine.activeAct().startedAt
  assert.equal(debug.engine.activeAct()?.sceneId, 'tool', 'команда → сцена с инструментом')
  assert.equal(debug.engine.resolve(toolStart).animId, 'toolEnter', 'сначала прибор входит в кадр')
  assert.equal(debug.engine.resolve(toolStart + 1500).animId, 'toolLoop', 'затем прибор остаётся в спокойной рабочей петле')

  debug.behavior.applySnapshot({ ...base, tool: { phase: 'writing', until: 0, seq: 2, open: true } }, true, toolStart + 2000)
  assert.equal(debug.engine.activeAct()?.pendingScene.sceneId, 'edit', 'файл → последняя фаза после минимального показа')
  assert.equal(debug.engine.resolve(toolStart + 2000).animId, 'toolExit', 'инструмент сначала уходит')
  debug.engine.resolve(toolStart + 3000)
  assert.equal(debug.engine.activeAct()?.sceneId, 'edit', 'после выхода начинается правка')
  assert.equal(debug.engine.resolve(toolStart + 3000).animId, 'editEnter', 'правка файла входит с документом и пером')

  debug.engine.clearAct(toolStart + 3100)
  debug.applySnapshot({
    ...base,
    mood: 'waiting',
    attention: { kind: 'blocked', count: 1, targetRef: 'preview' },
    navigation: { kind: 'attention', targetRef: 'preview' },
    tool: { phase: 'reading', until: 0, seq: 3, open: true },
  }, true)
  assert.equal(debug.engine.activeAct(), null, 'пока тебя ждут — никаких выходок')
  // Поля сверяем по отдельности: объекты из бандла живут в другом realm (jsdom).
  const action = debug.behavior.clickAction()
  assert.equal(action.kind, 'navigate', 'клик ведёт к запросу')
  assert.equal(action.targetRef, 'preview')
  assert.equal(action.requestKind, 'blocked')
  assert.equal(debug.behavior.bubble(now), 'Waiting for you', 'the default English wait phrase is fixed')
  assert.equal(debug.behavior.bubbleTone(now), 'alert', 'ожидание показывается янтарным')
  const bubble = h.host().querySelector('.bffg-status')
  assert.equal(bubble.dataset.tone, 'alert', 'тон доехал до DOM')

  // Возвращение к работе восстанавливает фазу; повтор того же снимка не перезапускает вход.
  const resumed = { ...base, tool: { phase: 'commanding', until: 0, seq: 3, open: true } }
  debug.applySnapshot(resumed, true)
  const resumedAt = debug.engine.activeAct().startedAt
  assert.equal(debug.engine.activeAct()?.sceneId, 'tool')
  debug.applySnapshot(resumed, false)
  assert.equal(debug.engine.activeAct()?.startedAt, resumedAt, 'тот же seq — не новый вызов')
  assert.deepEqual(h.errors, [])
})

test('пока оболочка на экране, встроенный пет скрыт; без неё — снова виден (один питомец)', { skip }, (t) => {
  const h = harness()
  t.after(() => h.cleanup())
  h.apply()
  const host = h.host()
  const debug = h.window.__BFFG_DEBUG__
  assert.notEqual(host.hidden, true, 'по умолчанию пет на месте')

  debug.applySnapshot({ mood: 'idle', shellActive: true }, true)
  assert.equal(host.hidden, true, 'оболочка на экране — встроенный пет скрыт')
  assert.equal(host.style.display, 'none', 'скрытие не должно зависеть от CSS хоста')

  debug.applySnapshot({ mood: 'idle', shellActive: false }, true)
  assert.equal(host.hidden, false, 'оболочка ушла — пет вернулся')
  assert.equal(host.style.display, '')
  assert.deepEqual(h.errors, [])
})

test('листы грузятся по мере надобности, а не все сразу (вес и стартовая цена)', { skip }, (t) => {
  const h = harness({ recordImages: true })
  t.after(() => h.cleanup())
  h.apply()
  assert.equal(h.requested.length, 1, `при появлении нужен только базовый лист, а запрошены: ${h.requested.join(', ')}`)
  assert.ok(h.requested[0].includes('spritesheet.png'), 'первым идёт базовый атлас')

  const debug = h.window.__BFFG_DEBUG__
  debug.engine.playAct('eatRice', 3000, { force: true })
  debug.draw(Date.now())
  assert.equal(h.requested.length, 2, 'лист еды подтянулся при первом использовании')
  assert.ok(h.requested[1].includes('spritesheet-food.png'), `ожидался лист еды, получено ${h.requested[1]}`)

  debug.draw(Date.now())
  assert.equal(h.requested.length, 2, 'повторный кадр не перезапрашивает лист')
  assert.deepEqual(h.errors, [])
})
