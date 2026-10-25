// The desktop page, executed as the browser would: jsdom runs the inline scripts of
// the built artifact itself, so self-containment, mounting and the shell bridge are
// all covered end to end.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { DEFAULT_MANIFEST } from '../lib/animation/manifest.mjs'

let JSDOM = null
try {
  ({ JSDOM } = await import('jsdom'))
} catch {
  JSDOM = null
}

const PAGE = new URL('../desktop/pet.html', import.meta.url)
const html = existsSync(PAGE) ? readFileSync(PAGE, 'utf8') : null
const skip = JSDOM === null
  ? 'jsdom не установлен — smoke-тест страницы пропущен (npm i -D jsdom)'
  : html === null
    ? 'desktop/pet.html не собран — сначала node scripts/build-desktop.mjs'
    : false

async function loadPage(options = {}) {
  const bridge = Object.assign({
    moves: [], menus: 0, sizes: [], quits: 0, frames: [],
    moveBy(dx, dy) { bridge.moves.push([dx, dy]) },
    menu(x, y, labels) { bridge.menus += 1; bridge.menuLabels = labels },
    setSize(px) { bridge.sizes.push(px) },
    quit() { bridge.quits += 1 },
    frame(info) { bridge.frames.push(info) },
    state(snapshot) { bridge.lastState = snapshot },
  }, options.bridge ?? {})
  const requested = []
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'http://127.0.0.1:19387/big-fat-fish-girl/v1/desktop',
    beforeParse(window) {
      window.HTMLCanvasElement.prototype.getContext = () => null
      if (options.recordImages === true) {
        window.Image = class {
          constructor() { this.listeners = {}; this.decoding = '' }
          addEventListener(type, listener) { (this.listeners[type] ??= []).push(listener) }
          set src(value) { this._src = value; requested.push(String(value)); queueMicrotask(() => (this.listeners.load ?? []).forEach((fn) => fn())) }
          get src() { return this._src }
        }
      }
      window.fetch = async () => ({
        ok: true,
        json: async () => ({ apiVersion: 1, mood: 'running', activeSessions: 1, until: 0 }),
      })
      window.EventSource = class { constructor() {} addEventListener() {} close() {} }
      window.__BFFG_DEBUG_ENABLED__ = true
      window.__BFFG_SHELL__ = bridge
    },
  })
  // let the inline bundle run and the first snapshot land
  await new Promise((resolve) => setTimeout(resolve, 60))
  return { dom, window: dom.window, document: dom.window.document, bridge, requested }
}

test('страница самодостаточна: ни одного внешнего script/link', { skip }, () => {
  const external = html.match(/<(?:script|link)[^>]*(?:src|href)=/gi) ?? []
  assert.deepEqual(external, [], 'страница не должна тянуть внешние файлы')
  assert.ok(html.includes('__BFFG_SHELL__'), 'контракт оболочки описан в странице')
})

test('страница монтируется и рисует питомца на прозрачном фоне', { skip }, async (t) => {
  const { dom, window, document } = await loadPage()
  t.after(() => dom.window.close())
  const host = document.querySelector('[data-bffg-desktop]')
  assert.ok(host, 'питомец должен появиться в DOM')
  // Состояние "running" теперь выглядит как спокойное «думаю» из поставки.
  assert.equal(host.dataset.mood, 'think', 'состояние пришло из /state')
  assert.ok(host.querySelector('canvas'), 'есть канвас')
  assert.equal(host.querySelector('.bffg-menu'), null, 'у страницы больше нет своего меню')
  const background = window.getComputedStyle(document.body).backgroundColor
  assert.ok(background === 'rgba(0, 0, 0, 0)' || background === 'transparent', `фон должен быть прозрачным, а не ${background}`)
})

test('оболочка получает текущий кадр и состояние — это нужно для клик-сквозь', { skip }, async () => {
  const { dom, bridge } = await loadPage()
  assert.ok(bridge.frames.length > 0, 'кадр должен быть передан в мост')
  const frame = bridge.frames[0]
  assert.equal(frame.sheet, 'base')
  assert.ok(Number.isInteger(frame.row) && Number.isInteger(frame.column))
  assert.equal(frame.flipX, false, 'alpha hit-test gets the rendered orientation')
  assert.equal(frame.cellWidth, 256)
  assert.equal(frame.cellHeight, 256)
  const host = dom.window.document.querySelector('[data-bffg-desktop]')
  assert.equal(host.style.getPropertyValue('--bffg-canvas-side'), '176px')
  assert.equal(host.style.getPropertyValue('--bffg-canvas-left'), '-22px')
  assert.ok(frame.columns >= 8)
  assert.equal(bridge.lastState?.mood, 'running')
  dom.window.close()
})

test('перетаскивание уходит в мост оболочки, а не в CSS окна', { skip }, async (t) => {
  const { dom, window, document, bridge } = await loadPage()
  const canvas = document.querySelector('[data-bffg-desktop] canvas')
  // Экранные координаты: окно уезжает из-под курсора, client-дельты «съедаются».
  canvas.dispatchEvent(new window.MouseEvent('pointerdown', { clientX: 40, clientY: 40, screenX: 40, screenY: 40, button: 0, bubbles: true }))
  canvas.dispatchEvent(new window.MouseEvent('pointermove', { clientX: 62, clientY: 48, screenX: 62, screenY: 48, bubbles: true }))
  canvas.dispatchEvent(new window.MouseEvent('pointerup', { clientX: 62, clientY: 48, screenX: 62, screenY: 48, bubbles: true }))
  assert.ok(bridge.moves.length > 0, 'мост должен получить перемещение окна')
  const [dx] = bridge.moves[0]
  assert.equal(dx, 22, 'шаг окна равен экранной дельте')
  dom.window.close()
})

test('native drag reports direction reversals to the page without pointermove', { skip }, async (t) => {
  for (const initial of ['left', 'right']) {
    let onNativeDragMove = null
    const starts = []
    const ends = []
    const { dom, window, document, bridge } = await loadPage({ bridge: {
      onDragMove(listener) { onNativeDragMove = listener; return () => { onNativeDragMove = null } },
      startDrag(session) { starts.push(session); return Promise.resolve(true) },
      endDrag(session) { ends.push(session); return Promise.resolve() },
    } })
    t.after(() => dom.window.close())
    const canvas = document.querySelector('[data-bffg-desktop] canvas')
    const fire = (type, x) => canvas.dispatchEvent(new window.MouseEvent(type, {
      clientX: x, clientY: 50, screenX: x, screenY: 50, button: 0, bubbles: true,
    }))
    fire('pointerdown', 100)
    fire('pointermove', initial === 'right' ? 130 : 70)
    await new Promise((resolve) => setTimeout(resolve, 0))

    const session = starts[0]
    assert.equal(typeof onNativeDragMove, 'function', 'native event subscription is active')
    assert.equal(bridge.moves.length, 0, 'page stops moving the window after successful takeover')
    assert.equal(window.__BFFG_DEBUG__.engine.resolve().animId, initial === 'right' ? 'runRight' : 'runLeft')
    const reversal = initial === 'right'
      ? [[-8, 'runLeft'], [8, 'runRight'], [-8, 'runLeft']]
      : [[8, 'runRight'], [-8, 'runLeft'], [8, 'runRight']]
    for (const [dx, expected] of reversal) {
      onNativeDragMove({ session, dx })
      assert.equal(window.__BFFG_DEBUG__.engine.resolve().animId, expected)
    }
    const finalDirection = reversal.at(-1)[1]
    onNativeDragMove({ session, dx: 0.1 })
    assert.equal(window.__BFFG_DEBUG__.engine.resolve().animId, finalDirection, 'subpixel movement preserves direction')

    fire(initial === 'right' ? 'pointerup' : 'pointercancel', initial === 'right' ? 130 : 70)
    assert.deepEqual(ends, [session], 'pointerup and pointercancel release native sessions')
    onNativeDragMove({ session, dx: finalDirection === 'runRight' ? -8 : 8 })
    assert.notEqual(window.__BFFG_DEBUG__.engine.resolve().animId, 'runRight')
    assert.notEqual(window.__BFFG_DEBUG__.engine.resolve().animId, 'runLeft')
    dom.window.close()
  }
})

test('native drag fallback moves accumulated deltas when takeover fails', { skip }, async (t) => {
  for (const failure of ['false', 'rejected']) {
    const { dom, window, document, bridge } = await loadPage({ bridge: {
      onDragMove() { return () => {} },
      startDrag() {
        return failure === 'false' ? Promise.resolve(false) : Promise.reject(new Error('takeover failed'))
      },
      endDrag() { return Promise.resolve() },
    } })
    t.after(() => dom.window.close())
    const canvas = document.querySelector('[data-bffg-desktop] canvas')
    const fire = (type, x) => canvas.dispatchEvent(new window.MouseEvent(type, {
      clientX: x, clientY: 50, screenX: x, screenY: 50, button: 0, bubbles: true,
    }))
    fire('pointerdown', 100)
    fire('pointermove', 120)
    fire('pointermove', 128)
    assert.equal(bridge.moves.length, 0, 'fallback waits while native ownership is unresolved')
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.deepEqual(bridge.moves, [[28, 0]], `${failure} takeover failure keeps the page fallback`)
    fire('pointercancel', 128)
  }
})

test('focus loss ends an active native drag and resets its direction', { skip }, async (t) => {
  let onNativeDragMove = null
  const starts = []
  const ends = []
  const { dom, window, document } = await loadPage({ bridge: {
    onDragMove(listener) { onNativeDragMove = listener; return () => { onNativeDragMove = null } },
    startDrag(session) { starts.push(session); return Promise.resolve(true) },
    endDrag(session) { ends.push(session); return Promise.resolve() },
  } })
  t.after(() => dom.window.close())
  const canvas = document.querySelector('[data-bffg-desktop] canvas')
  canvas.dispatchEvent(new window.MouseEvent('pointerdown', { screenX: 100, screenY: 50, button: 0, bubbles: true }))
  canvas.dispatchEvent(new window.MouseEvent('pointermove', { screenX: 130, screenY: 50, bubbles: true }))
  await new Promise((resolve) => setTimeout(resolve, 0))
  const session = starts[0]
  onNativeDragMove({ session, dx: 10 })
  assert.equal(window.__BFFG_DEBUG__.engine.resolve().animId, 'runRight')
  window.dispatchEvent(new window.Event('blur'))
  assert.deepEqual(ends, [session], 'blur releases the native session')
  onNativeDragMove({ session, dx: -10 })
  assert.notEqual(window.__BFFG_DEBUG__.engine.resolve().animId, 'runLeft')
  assert.notEqual(window.__BFFG_DEBUG__.engine.resolve().animId, 'runRight')
})

test('правый клик открывает нативное меню; подписи приходят из i18n', { skip }, async (t) => {
  const { dom, window, document, bridge } = await loadPage()
  const canvas = document.querySelector('[data-bffg-desktop] canvas')
  canvas.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
  assert.equal(bridge.menus, 1)
  // Текст меню живёт в strings.mjs, а не в оболочке; настройки уехали в Harness,
  // поэтому в меню остались только действия оболочки.
  assert.equal(bridge.menuLabels?.hide, 'Hide for this run', 'default English label from i18n')
  assert.equal(bridge.menuLabels?.quit, 'Quit')
  assert.equal(bridge.menuLabels?.size, undefined, 'размера в меню больше нет')
  assert.equal(document.querySelector('[data-bffg-desktop] .bffg-menu'), null, 'встроенного меню больше нет')
  dom.window.close()
})

test('без моста страница остаётся рабочей (превью в браузере)', { skip }, async () => {
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'http://127.0.0.1:19387/big-fat-fish-girl/v1/desktop?size=96',
    beforeParse(window) {
      window.HTMLCanvasElement.prototype.getContext = () => null
      window.fetch = async () => ({
        ok: true,
        json: async () => ({
          apiVersion: 1, mood: 'waiting', activeSessions: 0, until: 0,
          prefs: { size: 96 },
        }),
      })
      window.EventSource = class { constructor() {} addEventListener() {} close() {} }
    },
  })
  await new Promise((resolve) => setTimeout(resolve, 60))
  const host = dom.window.document.querySelector('[data-bffg-desktop]')
  assert.ok(host, 'питомец монтируется и без оболочки')
  assert.equal(host.style.getPropertyValue('--bffg-size'), '96px', 'размер приходит из настроек плагина')
  assert.equal(host.style.getPropertyValue('--bffg-canvas-side'), '128px', 'в квадратной клетке размер рисунка прежний')
  assert.equal(host.style.getPropertyValue('--bffg-canvas-left'), '-16px', 'центр клетки совпадает с прежней осью')
  const canvas = host.querySelector('canvas')
  canvas.dispatchEvent(new dom.window.MouseEvent('pointerdown', { clientX: 10, clientY: 10, screenX: 10, screenY: 10, button: 0, bubbles: true }))
  canvas.dispatchEvent(new dom.window.MouseEvent('pointermove', { clientX: 30, clientY: 10, screenX: 30, screenY: 10, bubbles: true }))
  assert.equal(host.style.position, 'absolute', 'без моста питомец двигается внутри страницы')
  assert.equal(host.dataset.mood, DEFAULT_MANIFEST.states.waiting.anim, 'ожидание — пилотная полоса')
  const bubble = host.querySelector('.bffg-bubble')
  assert.equal(bubble.textContent, 'Waiting for you')
  assert.equal(bubble.dataset.tone, 'alert', 'ожидание показывается янтарным и в оболочке')
  dom.window.close()
})

test('с границами экрана питомец сам идёт по рабочему столу', { skip }, async (t) => {
  const { dom, window, bridge } = await loadPage()
  t.after(() => dom.window.close())
  const debug = window.__BFFG_DEBUG__
  assert.ok(debug, 'отладочный шов доступен')
  debug.commands.setBounds({ minX: 100, maxX: 800 })
  // Прогулка разрешена только при «тихом» смысловом состоянии, а не по имени кадра.
  debug.applySnapshot({ mood: 'idle', activeSessions: 0, until: 0 }, true)
  bridge.moves.length = 0

  const base = Date.now() + 30000
  debug.wanderer.forceStroll(base)   // прогулки редкие — просим одну немедленно
  let moved = 0
  for (let i = 1; i <= 40; i += 1) {
    const move = debug.applyWander(base + i * 100)
    if (move && move.walking) moved += Math.abs(move.dx)
  }
  assert.ok(moved > 0, 'за 4 секунды питомец должен пройти расстояние')
  assert.ok(bridge.moves.length > 0, 'окно двигается через мост')
  assert.ok(bridge.moves.every(([, dy]) => dy === 0), 'ходит только по горизонтали')
  dom.window.close()
})

test('без границ экрана окно не гуляет: лучше стоять, чем уйти за край', { skip }, async (t) => {
  const { dom, window, bridge } = await loadPage()
  t.after(() => dom.window.close())
  const debug = window.__BFFG_DEBUG__
  debug.applySnapshot({ mood: 'idle', activeSessions: 0, until: 0 }, true)
  bridge.moves.length = 0
  const base = Date.now() + 30000
  for (let i = 1; i <= 30; i += 1) debug.applyWander(base + i * 100)
  assert.equal(bridge.moves.length, 0, 'пока оболочка не сообщила границы, окно стоит')
  const minimal = debug.commands.setBounds({ minX: 'нет' })
  assert.equal(minimal, false, 'мусорные границы отклоняются')
  dom.window.close()
})

test('оболочка тоже реагирует на инструмент: фаза приходит из снимка', { skip }, async (t) => {
  const { dom, window } = await loadPage()
  t.after(() => dom.window.close())
  const debug = window.__BFFG_DEBUG__
  const now = Date.now()
  debug.applySnapshot(
    { mood: 'running', activeSessions: 1, until: 0, tool: { phase: 'browsing', until: 0, seq: 1, open: true } },
    true,
  )
  const startedAt = debug.engine.activeAct().startedAt
  assert.equal(debug.engine.activeAct()?.sceneId, 'processing', 'поиск в сети → спокойная рабочая сцена')
  assert.equal(debug.engine.resolve(startedAt).animId, 'thinkEnter', 'сначала спокойный вход в сцену')
  assert.equal(debug.engine.resolve(startedAt + 2000).animId, 'thinkLoop', 'затем цикл спокойного «думаю»')
  const bubble = window.document.querySelector('[data-bffg-desktop] .bffg-bubble')
  assert.equal(bubble.hidden, false, 'фраза про инструмент показана')
  assert.ok((bubble.textContent ?? '').length > 0)
})

test('оболочка тоже тянет листы лениво', { skip }, async (t) => {
  const { dom, window, requested } = await loadPage({ recordImages: true })
  t.after(() => dom.window.close())
  // Харнесс отдаёт состояние "running", поэтому нужны базовый лист и рабочий — и только они.
  assert.ok(requested.length <= 2, `лишние листы при старте: ${requested.join(', ')}`)
  assert.equal(requested.some((url) => url.includes('spritesheet-food.png')), false, 'еда не тянется, пока не понадобилась')
  assert.equal(requested.some((url) => url.includes('spritesheet-idle.png')), false, 'лист простоя тоже ждёт своего часа')

  const debug = window.__BFFG_DEBUG__
  debug.engine.playAct('tokenWallet', 3000, { force: true })
  debug.draw(Date.now())
  assert.equal(requested.filter((url) => url.includes('spritesheet-food.png')).length, 1, 'лист еды подтянулся по требованию')
  debug.draw(Date.now())
  assert.equal(requested.filter((url) => url.includes('spritesheet-food.png')).length, 1, 'повторный кадр не перезапрашивает')
})

test('the visible desktop request bubble opens the pinned target', { skip }, async (t) => {
  const targets = []
  const { dom, window, bridge } = await loadPage({ bridge: { openTarget: (target) => targets.push(target) } })
  t.after(() => dom.window.close())
  window.__BFFG_DEBUG__.applySnapshot({
    mood: 'waiting', activeSessions: 1, until: 0,
    attention: { kind: 'approval', count: 1, targetRef: 'request-1' },
    navigation: { kind: 'attention', targetRef: 'request-1' },
  }, true)
  const bubble = window.document.querySelector('.bffg-bubble')
  assert.equal(bubble.hidden, false)
  assert.equal(bubble.textContent, 'Waiting for you')
  bubble.click()
  assert.equal(targets.length, 1)
  assert.equal(targets[0].targetRef, 'request-1')
  assert.equal(targets[0].kind, 'approval')
  assert.equal(bridge.moves.length, 0, 'clicking the bubble never starts a drag')
})
