// Engine: priority order, transients, gaze, explicit acts and unavailability.
// Every case drives a fixed clock, so nothing here depends on wall time.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createEngine } from '../lib/animation/engine.mjs'
import { indexManifest } from '../lib/animation/manifest.mjs'
import { DEFAULT_MANIFEST } from '../lib/animation/manifest.mjs'
import { gazeProfileForSkin } from '../lib/animation/gaze.mjs'
import { DEFAULT_SKIN } from '../lib/settings/prefs.mjs'

const index = indexManifest(DEFAULT_MANIFEST)

// Состояния берём из манифеста: анимация для «работаю» и «закончила» — это данные,
// и тест не должен ломаться, когда арт меняется.
const RUNNING_ANIM = DEFAULT_MANIFEST.states.running.anim
const REVIEW_ANIM = DEFAULT_MANIFEST.states.review.anim

function setup(start = 1000) {
  let now = start
  const engine = createEngine({ index, clock: () => now })
  return {
    engine,
    at: () => now,
    advance(ms) { now += ms; return now },
    set(ms) { now = ms; return now },
  }
}

test('ожидание пользователя важнее работы', () => {
  const { engine } = setup()
  engine.setSnapshot({ mood: 'waiting', activeSessions: 2 })
  assert.equal(engine.resolve().animId, DEFAULT_MANIFEST.states.waiting.anim)
})

test('burst приветствия/итога/ошибки живёт до until и потом уступает состоянию', () => {
  const { engine, at, advance } = setup(1000)
  engine.setSnapshot({ mood: 'review', until: at() + 500 })
  assert.equal(engine.resolve().animId, REVIEW_ANIM)
  advance(499)
  assert.equal(engine.resolve().animId, REVIEW_ANIM)
  advance(2)
  assert.equal(engine.resolve().animId, 'idle')
})

test('работа показывается, пока есть активные сессии', () => {
  const { engine } = setup()
  engine.setSnapshot({ mood: 'idle', activeSessions: 1 })
  assert.equal(engine.resolve().animId, RUNNING_ANIM)
  engine.setSnapshot({ mood: 'idle', activeSessions: 0 })
  assert.equal(engine.resolve().animId, 'idle')
})

test('перетаскивание задаёт направление и выбирает правильную строку кадров', () => {
  const { engine, advance } = setup()
  engine.setMoving('left')
  const left = engine.resolve()
  assert.equal(left.animId, 'runLeft')
  assert.equal(left.row, 2)
  advance(150)
  assert.equal(engine.resolve().column, 1, 'the left strip advances by its own frames')
  engine.setMoving('right')
  const right = engine.resolve()
  assert.equal(right.animId, 'runRight')
  assert.equal(right.row, 1)
  assert.equal(right.column, 0, 'a reversal starts from the matching right-facing pose')
  engine.setMoving(null)
  assert.equal(engine.resolve().animId, 'idle')
})

test('terminal problems outrank dragging, while completion notes do not', () => {
  const { engine, at } = setup()
  engine.setMoving('left')
  for (const mood of ['failed', 'limited']) {
    engine.setSnapshot({ mood, until: at() + 500 })
    assert.equal(engine.resolve().animId, DEFAULT_MANIFEST.states[mood].anim, `${mood} stays visible while dragging`)
  }
  engine.setSnapshot({ mood: 'review', until: at() + 500 })
  assert.equal(engine.resolve().animId, 'runLeft', 'dragging remains above a completion note')
})

test('явная выходка вытесняет состояние и заканчивается по времени', () => {
  const { engine, at, advance } = setup(1000)
  engine.setSnapshot({ mood: 'running', activeSessions: 1 })
  assert.equal(engine.playAct('jump', 400), true)
  assert.equal(engine.resolve().animId, 'jump')
  advance(399)
  assert.equal(engine.resolve().animId, 'jump')
  advance(2)
  assert.equal(engine.resolve().animId, RUNNING_ANIM)
  assert.equal(engine.activeAct(), null)
  assert.ok(at() > 0)
})

test('ожидание не перебивает ничто: ни сценка, ни ручное действие', () => {
  const { engine } = setup()
  engine.setSnapshot({ mood: 'waiting' })
  assert.equal(engine.playAct('wave', 900), false, 'спонтанная выходка уступает')
  assert.equal(engine.playAct('wave', 900, { force: true }), false, 'и ручная тоже: сначала решение')
  assert.equal(engine.resolve().animId, DEFAULT_MANIFEST.states.waiting.anim)
})

test('запущенная сценка прерывается приходом ожидания', () => {
  const { engine } = setup(1000)
  engine.setSnapshot({ mood: 'running', activeSessions: 1 })
  assert.equal(engine.playAct('jump', 5000), true)
  assert.equal(engine.resolve().animId, 'jump')
  engine.setSnapshot({ mood: 'waiting', activeSessions: 1 })
  assert.equal(engine.activeAct(), null, 'сценка снята сразу, а не по таймеру')
  assert.equal(engine.resolve().animId, DEFAULT_MANIFEST.states.waiting.anim)
})

test('недоступная анимация не играется и не выбирается', () => {
  const { engine } = setup()
  engine.setUnavailable('jump', true)
  assert.equal(engine.playAct('jump', 500), false)
  assert.equal(engine.isAvailable('jump'), false)
  engine.setUnavailable('jump', false)
  assert.equal(engine.isAvailable('jump'), true)
})

test('взгляд работает в простое и пропадает в работе', () => {
  const { engine } = setup()
  engine.setGaze(3)
  const idle = engine.resolve()
  assert.equal(idle.animId, 'gaze')
  assert.deepEqual({ row: idle.row, column: idle.column }, { row: 9, column: 3 })
  engine.setSnapshot({ mood: 'running', activeSessions: 1 })
  assert.equal(engine.resolve().animId, RUNNING_ANIM)
  engine.setSnapshot({ mood: 'idle', activeSessions: 0 })
  engine.setGaze(11)
  const gaze2 = engine.resolve()
  assert.deepEqual({ row: gaze2.row, column: gaze2.column }, { row: 10, column: 3 })
})

test('DeepSeek gaze mirrors the authored half-strip instead of turning the body', () => {
  const { engine } = setup()
  engine.setGaze(11, gazeProfileForSkin(DEFAULT_SKIN))
  const gaze = engine.resolve()
  assert.deepEqual(
    { row: gaze.row, column: gaze.column, flipX: gaze.flipX },
    { row: 9, column: 3, flipX: true },
  )
})

test('reduced motion держит первый кадр и не мешает выбору анимации', () => {
  const { engine, advance } = setup(0)
  engine.setReducedMotion(true)
  advance(5000)
  const idle = engine.resolve()
  assert.equal(idle.animId, 'idle')
  assert.equal(idle.row, 0)
  assert.equal(idle.column, 0)
  assert.equal(idle.reduced, true)
})

test('один и тот же вход даёт один и тот же кадр', () => {
  const a = setup(5000)
  const b = setup(5000)
  for (const s of [a, b]) {
    s.engine.setSnapshot({ mood: 'idle', activeSessions: 0, until: 0 })
    s.engine.setGaze(5)
  }
  a.advance(700)
  b.advance(700)
  assert.deepEqual(a.engine.resolve(), b.engine.resolve())
})

test('debug отдаёт внутреннее состояние для диагностики', () => {
  const { engine } = setup()
  engine.setSnapshot({ mood: 'running', activeSessions: 1 })
  engine.setGaze(2)
  const debug = engine.debug()
  assert.equal(debug.animId, RUNNING_ANIM)
  assert.equal(debug.gaze, 2)
  assert.deepEqual(debug.unavailable, [])
  assert.equal(debug.snapshot.activeSessions, 1)
})

test('сон остаётся спокойным при взгляде и немедленно уступает реальной работе', () => {
  const { engine } = setup()
  const SLEEP = DEFAULT_MANIFEST.states.sleeping.anim
  assert.equal(engine.isSleeping(), false)
  assert.notEqual(engine.resolve().animId, SLEEP)

  assert.equal(engine.setSleeping(true), true)
  assert.equal(engine.isSleeping(), true)
  assert.equal(engine.resolve().animId, 'sleepEnter')

  // Курсор не будит и не подменяет сцену сна.
  engine.setGaze(4)
  assert.equal(engine.resolve().animId, 'sleepEnter')

  // Любое реальное состояние будит немедленно.
  engine.setGaze(null)
  engine.setSnapshot({ mood: 'running', activeSessions: 1 })
  assert.equal(engine.isSleeping(), false)
  assert.equal(engine.resolve().animId, RUNNING_ANIM)

  engine.setSnapshot({ mood: 'idle', activeSessions: 0 })
  assert.equal(engine.resolve().animId, 'idle', 'сон не возвращается сам по себе')
})

test('сон виден в диагностике', () => {
  const { engine } = setup()
  engine.setSleeping(true)
  assert.equal(engine.debug().sleeping, true)
  engine.setSleeping(false)
  assert.equal(engine.debug().sleeping, false)
})

// ---- scenes: enter / loop / exit with graceful fallback --------------------------------

function sceneFixture() {
  return {
    version: 1,
    sheets: { s: { file: 'fixture.png', columns: 8, rows: 4, cellWidth: 192, cellHeight: 256 } },
    animations: [
      { id: 'enter', sheet: 's', row: 0, frames: 4, fps: 10, loop: false },
      { id: 'loop', sheet: 's', row: 1, frames: 4, fps: 1, loop: true },
      { id: 'exit', sheet: 's', row: 2, frames: 4, fps: 10, loop: false },
      { id: 'plain', sheet: 's', row: 3, frames: 2, fps: 1, loop: true },
    ],
    states: { idle: { anim: 'plain' } },
    scenes: {
      demo: { enter: 'enter', loop: 'loop', exit: 'exit', fallback: 'plain' },
      fallbackOnly: { loop: 'missingLoop', exit: 'missingExit', fallback: 'plain' },
    },
  }
}

test('сцена играет войти → цикл → выйти, а вход не зацикливается', () => {
  let now = 0
  const engine = createEngine({ index: indexManifest(sceneFixture()), clock: () => now })
  assert.equal(engine.playScene('demo', 1000), true)
  assert.equal(engine.resolve(0).animId, 'enter', 'сначала вход')
  now = 500
  assert.equal(engine.resolve(500).animId, 'loop', 'середина — тихий цикл')
  now = 750
  assert.equal(engine.resolve(750).animId, 'exit', 'перед концом — выход')
  now = 1001
  assert.equal(engine.resolve(1001).animId, 'plain', 'после сцены — обычное состояние')
  assert.equal(engine.activeAct(), null)
})

test('scene callbacks use the explicit render and interruption timestamps', () => {
  const engine = createEngine({ index: indexManifest(sceneFixture()), clock: () => 0 })
  const events = []
  engine.setSceneListener((event) => events.push(event))
  assert.equal(engine.playScene('demo', 1000, { now: 100 }), true)
  engine.resolve(100, { render: false })
  engine.resolve(150)
  engine.clearAct(200)
  assert.deepEqual(events.map(({ type, at }) => [type, at]), [
    ['start', 100], ['segment', 100], ['render', 150], ['interrupt', 200],
  ])
})

test('a work scene loops for one minute without replaying its entrance', () => {
  const { engine } = setup(0)
  const starts = []
  engine.setSceneListener((event) => { if (event.type === 'start') starts.push(event.sceneId) })
  engine.playScene('edit', Infinity, { now: 0 })
  const visible = []
  for (let now = 0; now <= 60_000; now += 100) visible.push(engine.resolve(now))
  assert.deepEqual(starts, ['edit'])
  assert.equal(visible[0].animId, 'editEnter')
  assert.ok(visible.slice(8).every((frame) => frame.animId !== 'editEnter'), 'entry is one-shot')
  assert.ok(visible.slice(8).every((frame) => frame.sceneId === 'edit'))
  assert.ok(new Set(visible.slice(8).map((frame) => `${frame.row}:${frame.column}`)).size > 1, 'the work loop moves')
})

test('sleep remains in its breathing cycle for ten minutes and cursor gaze does not wake it', () => {
  const { engine } = setup(0)
  const starts = []
  engine.setSceneListener((event) => { if (event.type === 'start') starts.push(event.sceneId) })
  engine.setSleeping(true, 0)
  let finalFrame = null
  for (let now = 0; now <= 10 * 60 * 1000; now += 1000) {
    engine.setGaze(now % 2000 === 0 ? 4 : null)
    finalFrame = engine.resolve(now)
  }
  assert.deepEqual(starts, ['sleep'])
  assert.equal(engine.isSleeping(), true)
  assert.equal(finalFrame.sceneId, 'sleep')
  assert.equal(finalFrame.animId, 'sleepBreath')
})

test('scene transitions retain only the latest pending destination', () => {
  const engine = createEngine({ index: indexManifest(sceneFixture()), clock: () => 0 })
  engine.playScene('demo', Infinity, { now: 0 })
  engine.playScene('fallbackOnly', Infinity, { now: 100 })
  engine.playScene('demo', Infinity, { now: 200 })
  assert.equal(engine.activeAct().pendingScene.sceneId, 'demo')
  assert.equal(engine.resolve(500).animId, 'enter')
  assert.equal(engine.activeAct().sceneId, 'demo')
  assert.equal(engine.activeAct().startedAt, 500)
})

test('недоступные сегменты сцены уходят в fallback, а не в пустоту', () => {
  let now = 0
  const engine = createEngine({ index: indexManifest(sceneFixture()), clock: () => now })
  assert.equal(engine.playScene('fallbackOnly', 1000), true)
  assert.equal(engine.resolve(0).animId, 'plain', 'нет арта сегментов — работает старая анимация')
})

test('вариант сцены выбирается один раз, учитывает веса и доступность арта', () => {
  for (const [roll, expected] of [[0, 'snack'], [0.8, 'eatRice'], [0.95, 'sushiTray']]) {
    let randomCalls = 0
    const engine = createEngine({
      index,
      random: () => { randomCalls += 1; return roll },
      clock: () => 0,
    })
    assert.equal(engine.playScene('meal', 10_000, { now: 0 }), true)
    for (const now of [0, 1800, 7500]) {
      assert.equal(engine.resolve(now).animId, expected, `вариант ${expected} стабилен на ${now} ms`)
    }
    engine.setReducedMotion(true)
    assert.equal(engine.resolve(8000).animId, expected, 'reduced motion сохраняет выбранный вариант')
    assert.equal(engine.activeAct().variantAnimId, expected)
    assert.equal(randomCalls, 1, 'случайное число берётся только при старте сцены')
  }

  const engine = createEngine({ index, random: () => 0, clock: () => 0 })
  engine.setUnavailable('snack')
  assert.equal(engine.playScene('meal', 10_000, { now: 0 }), true)
  assert.equal(engine.resolve(0).animId, 'eatRice', 'недоступный вариант пропускается до взвешенного выбора')
})

test('выбранный вариант сохраняется, пока сцена ожидает завершения предыдущей', () => {
  const engine = createEngine({ index, random: () => 0, clock: () => 0 })
  assert.equal(engine.playScene('edit', Infinity, { now: 0 }), true)
  assert.equal(engine.playScene('meal', 10_000, { now: 0, variantId: 'sushiTray' }), true)
  assert.equal(engine.activeAct().pendingScene.options.variantId, 'sushiTray')
  assert.equal(engine.resolve(800).animId, 'sushiTray', 'после выхода из edit начинается суши-сценка')
  assert.equal(engine.activeAct().variantAnimId, 'sushiTray')
})

test('ожидание отказывает и сцене', () => {
  let now = 0
  const engine = createEngine({ index: indexManifest(sceneFixture()), clock: () => now })
  engine.setSnapshot({ mood: 'waiting' })
  assert.equal(engine.playScene('demo', 1000), false)
})

test('a scene listener that throws is reported, and the frame still draws', () => {
  const failures = []
  const engine = createEngine({
    index,
    clock: () => 0,
    onError: (error) => failures.push(error.message),
  })
  engine.setSceneListener(() => { throw new Error('listener broke') })
  assert.equal(engine.playScene('review', 2000, { now: 0 }), true)
  assert.deepEqual(failures, ['listener broke'], 'the failure is reported, not swallowed')
  assert.ok(engine.resolve(100), 'the engine keeps resolving frames')
})
