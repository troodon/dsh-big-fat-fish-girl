// The shared controller: one priority list for pose, bubble and click. These tests
// drive a fake clock and a seeded RNG, so they assert behaviour, not wall time.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createEngine } from '../lib/animation/engine.mjs'
import { DEFAULT_MANIFEST, indexManifest } from '../lib/animation/manifest.mjs'
import { createBehavior, TEMPO } from '../lib/behavior/behavior.mjs'
import { createRandom } from '../lib/behavior/planner.mjs'

const index = indexManifest(DEFAULT_MANIFEST)

function setup(start = 1000) {
  let now = start
  const engine = createEngine({ index, clock: () => now })
  const behavior = createBehavior({ index, engine, random: createRandom(7), clock: () => now })
  behavior.start(now)
  return {
    engine,
    behavior,
    at: () => now,
    advance(ms) { now += ms; return now },
    setTime(value) { now = value; return now },
    frame(value) {
      now = value
      behavior.update(value)
      return engine.resolve(value)
    },
  }
}

const waitingSnapshot = (at, targetRef = 's1') => ({
  mood: 'waiting',
  until: 0,
  activeSessions: 1,
  attention: { kind: 'approval', count: 1, targetRef },
  navigation: { kind: 'attention', targetRef },
})

test('ожидание: фиксированная фраза, приоритет клика и никакого hover', () => {
  const { engine, behavior, advance } = setup()
  behavior.applySnapshot(waitingSnapshot(1000), true, 1000)
  behavior.update(1000)
  assert.equal(behavior.bubble(1000), 'Жду тебя')
  assert.equal(behavior.bubble(1000 + 60000), 'Жду тебя', 'фраза не ротируется')
  assert.deepEqual(behavior.clickAction(), { kind: 'navigate', targetRef: 's1', requestKind: 'approval' })
  assert.equal(behavior.hover(1000), false, 'наведение не перебивает ожидание')
  assert.equal(engine.activeAct(), null)
  advance(1000)
  assert.equal(engine.resolve(2000).animId, DEFAULT_MANIFEST.states.waiting.anim)
})

test('проблема: тихая фраза, переход в чат, исчезает по таймеру', () => {
  const { behavior } = setup()
  behavior.applySnapshot({
    mood: 'failed',
    until: 1000 + 2400,
    navigation: { kind: 'failed', targetRef: 's2' },
  }, true, 1000)
  assert.equal(behavior.bubble(1000), 'Нужна твоя помощь')
  assert.deepEqual(behavior.clickAction(), { kind: 'navigate', targetRef: 's2', requestKind: 'failed' })
  assert.equal(behavior.bubble(1000 + 2500), null, 'после вспышки — тишина, а не вечный упрёк')
})

test('лимит токенов — отдельная тихая пометка, а не праздник', () => {
  const { behavior } = setup()
  behavior.applySnapshot({ mood: 'limited', until: 1000 + 3000, navigation: { kind: 'limited', targetRef: 's3' } }, true, 1000)
  assert.equal(behavior.bubble(1000), 'Остановилась по лимиту')
  assert.equal(behavior.clickAction().targetRef, 's3')
})

test('рабочая фаза превращается в сцену с входом/циклом/выходом', () => {
  const { engine, behavior } = setup()
  behavior.applySnapshot({ mood: 'running', activeSessions: 1, tool: { phase: 'writing', open: true, seq: 1 } }, true, 1000)
  behavior.update(1000)
  assert.equal(behavior.debug().scene, 'edit')
  assert.equal(engine.activeAct().kind, 'scene')
  assert.equal(engine.resolve(1000).animId, 'editEnter', 'правка начинается с отдельного входа')
  assert.equal(engine.resolve(1900).animId, 'editLoop', 'после входа остаётся спокойная рабочая петля')

  behavior.applySnapshot({ mood: 'running', activeSessions: 1, tool: { phase: 'reading', open: true, seq: 2 } }, true, 7000)
  assert.equal(engine.activeAct().pendingScene.sceneId, 'reading', 'последняя фаза ждёт завершения выхода')
  assert.equal(engine.resolve(7000).animId, 'editExit', 'старую сцену сначала аккуратно закрываем')
  behavior.update(7800)
  assert.equal(behavior.debug().scene, 'reading')
  assert.equal(engine.resolve(7800).animId, 'readEnter', 'чтение начинается с собственного входа')

  behavior.applySnapshot({ mood: 'running', activeSessions: 1, tool: null, phase: null }, true, 10_000)
  assert.equal(engine.activeAct().sceneId, 'reading', 'рабочая фаза выдерживает минимальное время показа')
  behavior.update(10_000)
  assert.equal(engine.activeAct().ending, true, 'последняя фаза корректно уходит через exit')
})

test('без арта сегмента сцена уходит в fallback, а не в пустоту', () => {
  const { engine, behavior } = setup()
  for (const animId of ['editEnter', 'editLoop', 'editExit', 'editFile']) engine.setUnavailable(animId)
  behavior.applySnapshot({ mood: 'running', activeSessions: 1, tool: { phase: 'writing', open: true, seq: 1 } }, true, 1000)
  behavior.update(1000)
  assert.equal(engine.activeAct().kind, 'scene', 'сцена взяла fallback')
  assert.equal(engine.resolve(1000).animId, 'useTool', 'fallback используется, если все сегменты сцены недоступны')
})

test('в простое облачко не болтает, а сценка случается после паузы', () => {
  const { engine, behavior, advance } = setup()
  behavior.applySnapshot({ mood: 'idle', activeSessions: 0 }, false, 1000)
  assert.equal(behavior.bubble(1000), null)
  behavior.update(1000)
  assert.equal(engine.activeAct(), null, 'сразу после появления — никакой выходки')
  advance(90001)
  behavior.update(1000 + 90001)
  assert.notEqual(engine.activeAct(), null, 'после долгой паузы выходка разрешена')
})

test('сон приходит после 5–8 минут тишины и снимается реальным событием', () => {
  const { engine, behavior, advance } = setup()
  behavior.update(1000)
  advance(TEMPO.sleepAfterMs - 1)
  behavior.update(1000 + TEMPO.sleepAfterMs - 1)
  assert.equal(engine.isSleeping(), false)
  advance(2)
  behavior.update(1000 + TEMPO.sleepAfterMs + 1)
  assert.equal(engine.isSleeping(), true)

  behavior.applySnapshot({ mood: 'running', activeSessions: 1, tool: { phase: 'reading', open: true, seq: 1 } }, true, 2000)
  behavior.update(2000)
  assert.equal(engine.isSleeping(), false, 'работа будит')
})

test('cursor motion preserves sleep; an explicit click plays the wake exit and restarts quiet time', () => {
  const { engine, behavior, setTime } = setup()
  const asleepAt = 1000 + TEMPO.sleepAfterMs
  setTime(asleepAt)
  behavior.update(asleepAt)
  assert.equal(engine.isSleeping(), true)
  assert.equal(behavior.hover(asleepAt + 10), false)
  assert.equal(engine.isSleeping(), true, 'ordinary cursor motion is not a wake signal')

  const wakeAt = asleepAt + 20
  setTime(wakeAt)
  assert.equal(behavior.react(wakeAt), true, 'explicit interaction wakes the pet')
  assert.equal(engine.isSleeping(), false)
  assert.equal(engine.resolve(wakeAt).animId, 'sleepWake')

  const beforeNextSleep = wakeAt + TEMPO.sleepAfterMs - 1
  setTime(beforeNextSleep)
  behavior.update(beforeNextSleep)
  assert.equal(engine.isSleeping(), false, 'silence is counted from the explicit wake')
})

test('одно и то же облачко не повторяется чаще кулдауна', () => {
  const { behavior, advance } = setup()
  behavior.applySnapshot({ mood: 'running', activeSessions: 1, tool: { phase: 'commanding', open: true, seq: 1 } }, true, 1000)
  assert.ok((behavior.bubble(1000) ?? '').length > 0, 'первая фраза показана')
  advance(TEMPO.bubbleMs + 100)
  assert.equal(behavior.bubble(1000 + TEMPO.bubbleMs + 100), null, 'после короткой жизни — пауза')
  advance(TEMPO.bubbleCooldownMs)
  assert.ok((behavior.bubble(1000 + TEMPO.bubbleMs + TEMPO.bubbleCooldownMs + 200) ?? '').length > 0, 'потом можно снова')
})

test('bubbleInfo отдаёт пул: кошелёк помечен для числовой подсказки', () => {
  const { behavior } = setup()
  behavior.applySnapshot({ mood: 'review', activeSessions: 0, until: 3600, navigation: { kind: 'review', targetRef: 's1' } }, true, 1000)
  behavior.update(3600 + 400)
  assert.equal(behavior.debug().scene, 'wallet', 'кошелёк играет после завершения')
  const info = behavior.bubbleInfo(3600 + 401)
  if (info !== null) {
    assert.equal(info.pool, 'wallet', 'если кошелёк говорит, пул — wallet')
    assert.equal(info.tone, 'normal')
  }
})

test('в свободном состоянии клик даёт короткую реакцию, а не прыжок', () => {
  const { behavior, engine } = setup()
  behavior.applySnapshot({ mood: 'idle', activeSessions: 0 }, false, 1000)
  assert.deepEqual(behavior.clickAction(), { kind: 'react' })
  assert.equal(behavior.react(1000), true, 'деловой клик вызывает реакцию')
  assert.notEqual(engine.activeAct(), null)
})

test('клик не перебивает ожидание и проблему', () => {
  const { behavior, engine } = setup()
  behavior.applySnapshot(waitingSnapshot(1000), true, 1000)
  assert.equal(behavior.clickAction().kind, 'navigate')
  assert.equal(behavior.react(1000), false, 'в ожидании клик ведёт к запросу, а не к выходке')
  assert.equal(engine.activeAct(), null)
})

test('isQuiet решает по смыслу, а не по нарисованному кадру (регресс рывков)', () => {
  const { behavior, engine } = setup()
  behavior.applySnapshot({ mood: 'idle', activeSessions: 0 }, false, 1000)
  assert.equal(behavior.isQuiet(1000), true)
  // Ходьба меняет кадр на runLeft/runRight, но состояние остаётся спокойным —
  // именно на этом раньше ломалось решение «гулять или нет».
  engine.setMoving('left')
  assert.equal(behavior.isQuiet(1000), true, 'шаг не должен запрещать сам себя')

  behavior.applySnapshot({ mood: 'running', activeSessions: 1 }, true, 2000)
  assert.equal(behavior.isQuiet(2000), false, 'на работе не гуляем')

  engine.setSleeping(true)
  behavior.applySnapshot({ mood: 'idle', activeSessions: 0 }, false, 3000)
  assert.equal(behavior.isQuiet(3000), false, 'спящая не гуляет')
})

test('hover uses a compatible micro-reaction without resetting the working scene', () => {
  const { engine, behavior } = setup()
  behavior.applySnapshot(workSnapshot(), true, 1000)
  behavior.update(1000)
  const startedAt = engine.activeAct().startedAt
  engine.setGaze(4)
  assert.equal(behavior.hover(1000), true)
  assert.equal(engine.resolve(1000).animId, 'gaze')
  assert.equal(engine.activeAct().sceneId, 'edit')
  assert.equal(engine.activeAct().startedAt, startedAt)
  assert.equal(engine.resolve(1800).animId, 'editLoop', 'the underlying scene clock continued during the reaction')
})

test('team lifecycle keeps the scene and readable bubble stable while counts change', () => {
  const { behavior, engine } = setup()
  behavior.applySnapshot({ mood: 'running', activeSessions: 1, team: { active: 2, waiting: 1, completed: 0, errors: 0, coordinating: true } }, true, 1000)
  assert.equal(behavior.debug().scene, 'team')
  const startedAt = engine.activeAct().startedAt
  assert.equal(behavior.bubble(1000), 'Помощники: 2 работают · 1 ждут')

  behavior.applySnapshot({ mood: 'running', activeSessions: 1, team: { active: 3, waiting: 1, completed: 0, errors: 0, coordinating: true } }, true, 1100)
  assert.equal(engine.activeAct().startedAt, startedAt, 'ordinary helper count changes do not replay the entry gesture')
  assert.equal(behavior.bubble(1100), 'Помощники: 2 работают · 1 ждут', 'the current phrase keeps its reading time')
  assert.equal(behavior.bubble(1000 + TEMPO.bubbleMs), 'Помощники: 3 работают · 1 ждут', 'then the latest counts are shown')
})

test('queued tool errors coalesce and return to the latest work phase', () => {
  const { engine, behavior, frame } = setup()
  const working = { mood: 'running', activeSessions: 1, tool: { phase: 'writing', open: true, seq: 1 } }
  behavior.applySnapshot(working, true, 1000)
  behavior.update(1000)

  behavior.applySnapshot({ ...working, toolError: { id: '1', seq: 1 } }, true, 1100)
  behavior.update(1100)
  assert.equal(engine.activeAct().pendingScene.sceneId, 'toolError', 'error waits behind the work scene exit')
  behavior.applySnapshot({ ...working, tool: { phase: 'reading', open: true, seq: 2 }, toolError: { id: '2', seq: 2 } }, true, 1200)
  frame(1900)
  assert.equal(behavior.debug().scene, 'toolError')
  assert.equal(engine.resolve(1900).animId, 'toolErrorReaction')

  behavior.applySnapshot({ mood: 'running', activeSessions: 1, tool: { phase: 'reading', open: true, seq: 2 }, toolError: { id: '2', seq: 2 } }, true, 2000)
  frame(3500)
  assert.equal(behavior.debug().scene, 'reading', 'the latest phase resumes after the reaction')
  assert.equal(engine.resolve(3500).animId, 'readEnter')

  frame(6100)
  assert.equal(engine.activeAct().pendingScene.sceneId, 'toolError', 'multiple errors coalesce into one deferred follow-up')
})

test('an accelerated hour of team events, requests, errors and meals preserves scene invariants', () => {
  const { behavior, engine, setTime, frame } = setup()
  const phases = ['writing', 'reading', 'commanding', 'composing']
  let errorSeq = 0
  let lastError = null
  let lastTime = 1000

  for (let tick = 0; tick < 36_000; tick += 1) {
    const now = 1000 + tick * 100
    lastTime = now
    setTime(now)
    if (now >= 60_000 && (now - 60_000) % 30_000 < 100) {
      errorSeq += 1
      lastError = { id: String(errorSeq), seq: errorSeq }
    }
    const waiting = now >= 600_000 && (now - 600_000) % 900_000 < 3000
    const coordinating = Math.floor(now / 60_000) % 2 === 0
    const team = {
      active: coordinating ? (Math.floor(now / 1000) % 4) + 1 : 0,
      waiting: waiting ? 1 : (Math.floor(now / 15_000) % 2),
      completed: Math.floor(now / 30_000) % 3,
      errors: errorSeq % 2,
      coordinating: coordinating && !waiting,
    }
    const value = {
      mood: waiting ? 'waiting' : 'running',
      activeSessions: 1,
      attention: waiting ? { kind: 'approval', count: 1, targetRef: 'root' } : null,
      navigation: waiting ? { kind: 'attention', targetRef: 'root' } : { kind: 'task', targetRef: 'root' },
      tool: waiting ? null : { phase: phases[Math.floor(now / 120_000) % phases.length], open: true, seq: Math.floor(now / 120_000) + 1 },
      team,
      toolError: lastError,
      revision: tick,
    }
    behavior.applySnapshot(value, true, now)
    frame(now)
  }

  assert.equal(behavior.isWaiting(lastTime), false)
  assert.ok(behavior.debug().mealCooldownUntil > 0, 'at least one sufficiently shown snack completed during the hour')
  assert.ok(['team', 'edit', 'reading', 'processing', 'tool', 'compose', 'toolError'].includes(behavior.debug().scene)
    || behavior.debug().scene === null, 'the player remains in a known scene')
  assert.equal(engine.getSnapshot().team.coordinating, true, 'the final team state is current')
})

test('tool-error reactions yield to requests and remain deferred until the request clears', () => {
  const { engine, behavior, frame } = setup()
  behavior.applySnapshot({ mood: 'idle', activeSessions: 0 }, false, 1000)
  behavior.applySnapshot({ mood: 'idle', activeSessions: 0, toolError: { id: '1', seq: 1 } }, true, 1001)
  behavior.update(1001)
  assert.equal(behavior.debug().scene, 'toolError')

  behavior.applySnapshot(waitingSnapshot(1100), true, 1100)
  behavior.update(1100)
  assert.equal(engine.resolve(1100).animId, 'waitingCall')
  assert.equal(behavior.debug().deferredToolError, true)

  behavior.applySnapshot({ mood: 'idle', activeSessions: 0, toolError: { id: '1', seq: 1 } }, true, 6100)
  behavior.update(6100)
  assert.equal(behavior.debug().scene, 'toolError', 'the deferred reaction returns after the request ends')
  frame(6100)
})

test('жёлтая подача: ожидание, проблема, команды и правка файла; ответ — обычная', () => {
  const { behavior } = setup()
  behavior.applySnapshot(waitingSnapshot(1000), true, 1000)
  assert.equal(behavior.bubbleTone(1000), 'alert', 'Жду тебя — янтарное облачко')

  behavior.applySnapshot({ mood: 'running', activeSessions: 1, tool: { phase: 'commanding', open: true, seq: 1 } }, true, 2000)
  assert.equal(behavior.bubbleTone(2000), 'alert', 'команда меняет систему — предупреждаем')

  behavior.applySnapshot({ mood: 'running', activeSessions: 1, tool: { phase: 'writing', open: true, seq: 2 } }, true, 8000)
  assert.equal(behavior.bubbleTone(8000), 'alert', 'правка файла — тоже изменение')

  behavior.applySnapshot({ mood: 'running', activeSessions: 1, tool: null, phase: 'composing' }, true, 14000)
  assert.equal(behavior.bubbleTone(14000), 'normal', 'печатание ответа — не изменение на диске')

  behavior.applySnapshot({ mood: 'failed', until: 17000, navigation: { kind: 'failed', targetRef: 's2' } }, true, 15000)
  assert.equal(behavior.bubbleTone(15000), 'alert', 'ошибка — янтарное облачко')

  behavior.applySnapshot({ mood: 'idle', activeSessions: 0 }, false, 18000)
  assert.equal(behavior.bubbleTone(18000), 'normal')
})

test('one hover reaction keeps one phrase for five seconds across drawn frames', () => {
  const { behavior, frame } = setup()
  assert.equal(behavior.react(1000), true)
  const text = behavior.bubble(1000)
  assert.ok(text)
  for (let now = 1111; now < 1000 + TEMPO.hoverLineMs; now += 111) {
    frame(now)
    assert.equal(behavior.bubble(now), text, `the phrase did not change at ${now}`)
    assert.equal(behavior.bubbleInfo(now).text, text, 'multiple reads also preserve the phrase')
  }
  assert.equal(behavior.bubble(1000 + TEMPO.hoverLineMs), null)
})

test('rapid phase changes keep reading time and then show only the latest phase', () => {
  const { behavior } = setup()
  const snapshot = (phase, seq) => ({ mood: 'running', activeSessions: 1, tool: { phase, seq, open: true } })
  behavior.applySnapshot(snapshot('reading', 1), true, 1000)
  const first = behavior.bubbleInfo(1000)
  behavior.applySnapshot(snapshot('writing', 2), true, 1200)
  behavior.applySnapshot(snapshot('commanding', 3), true, 1400)
  behavior.applySnapshot(snapshot('browsing', 4), true, 1600)
  assert.deepEqual(behavior.bubbleInfo(1600), first)
  assert.deepEqual(behavior.bubbleInfo(5999), first)
  assert.equal(behavior.bubbleInfo(6000).pool, 'browsing', 'intermediate phases are not queued')
})

test('ordinary text survives a brief idle gap but requests and problems interrupt it', () => {
  const { behavior } = setup()
  behavior.applySnapshot({ mood: 'running', activeSessions: 1, phase: 'composing' }, true, 1000)
  const text = behavior.bubble(1000)
  behavior.applySnapshot({ mood: 'idle', activeSessions: 0 }, true, 1200)
  behavior.setLocale('ru')
  assert.equal(behavior.bubble(1200), text, 'idle and unchanged locale do not erase an unread phrase')
  behavior.applySnapshot(waitingSnapshot(1300), true, 1300)
  assert.equal(behavior.bubble(1300), 'Жду тебя')
  behavior.applySnapshot({ mood: 'failed', until: 5000 }, true, 1400)
  assert.equal(behavior.bubble(1400), 'Нужна твоя помощь')
  behavior.applySnapshot({ mood: 'idle', activeSessions: 0 }, true, 1500)
  assert.equal(behavior.bubble(1500), null, 'the interrupted phrase does not return')
})

// ---- M4: snack by work stack, wallet after completion ---------------------------------

const workSnapshot = (seq = 1) => ({
  mood: 'running',
  activeSessions: 1,
  tool: { phase: 'writing', open: true, seq },
})

function advanceUntilMeal(behavior, from, to, step = 4000, setTime = () => {}) {
  for (let t = from; t <= to; t += step) {
    setTime(t)
    behavior.update(t)
    if (behavior.debug().mealUntil > 0) return t
  }
  return null
}

test('перекус приходит после 3–5 минут работы и возвращает рабочую позу', () => {
  const { engine, behavior, setTime, frame } = setup()
  behavior.applySnapshot(workSnapshot(), true, 1000)
  behavior.update(1000)
  const startedAt = advanceUntilMeal(behavior, 10_000, 1000 + 6 * 60 * 1000, 4000, setTime)
  assert.ok(startedAt !== null, 'перекус начался')
  assert.equal(behavior.debug().scene, 'meal')
  assert.equal(engine.activeAct().sceneId, 'meal')

  // Досматриваем перекус — возвращается та же рабочая фаза.
  const deadline = behavior.debug().mealUntil
  for (let t = startedAt + 100; t <= deadline + 100; t += 100) frame(t)
  assert.equal(behavior.debug().mealUntil, 0)
  assert.equal(behavior.debug().scene, 'edit')
  assert.equal(engine.resolve(deadline + 100).animId, 'editEnter', 'после еды — снова вход в текущую рабочую сцену')
})

test('при частых кадрах перекус в очереди сохраняет один из вариантов еды', () => {
  const { engine, behavior, setTime } = setup()
  behavior.applySnapshot(workSnapshot(), true, 1000)
  behavior.update(1000)

  let mealVariant = null
  for (let t = 1100; t <= 1000 + 6 * 60 * 1000; t += 100) {
    setTime(t)
    engine.resolve(t)
    behavior.update(t)
    const act = engine.activeAct()
    if (act?.sceneId === 'meal') {
      mealVariant = act.variantAnimId
      break
    }
  }

  assert.ok(['snack', 'eatRice', 'sushiTray'].includes(mealVariant), 'у еды выбран доступный вариант, а не fallback из null')
})

test('ожидание не копит стаж и не пускает перекус; после него работа продолжает стек', () => {
  const { behavior, setTime } = setup()
  behavior.applySnapshot(workSnapshot(), true, 1000)
  for (let t = 10_000; t <= 1000 + 2 * 60 * 1000; t += 10_000) { setTime(t); behavior.update(t) }
  const waitingAt = 1000 + 2 * 60 * 1000
  setTime(waitingAt)
  behavior.applySnapshot({ ...waitingSnapshot(waitingAt), activeSessions: 1 }, true, waitingAt)
  for (let t = waitingAt; t <= 1000 + 12 * 60 * 1000; t += 10_000) { setTime(t); behavior.update(t) }
  assert.equal(behavior.debug().mealUntil, 0, 'в ожидании стаж заморожен — перекуса нет')

  const resumedAt = 1000 + 12 * 60 * 1000
  setTime(resumedAt)
  behavior.applySnapshot(workSnapshot(2), true, resumedAt)
  const startedAt = advanceUntilMeal(behavior, resumedAt, 1000 + 20 * 60 * 1000, 4000, setTime)
  assert.ok(startedAt !== null, 'после ожидания работа добрала стаж и перекус случился')
})

test('приход «Жду тебя» прерывает перекус немедленно', () => {
  const { engine, behavior, setTime } = setup()
  behavior.applySnapshot(workSnapshot(), true, 1000)
  behavior.update(1000)
  const startedAt = advanceUntilMeal(behavior, 10_000, 1000 + 6 * 60 * 1000, 4000, setTime)
  assert.ok(startedAt !== null, 'перекус начался')
  setTime(startedAt)
  behavior.applySnapshot(waitingSnapshot(startedAt), true, startedAt)
  assert.equal(behavior.debug().mealUntil, 0, 'перекус снят')
  assert.equal(behavior.debug().mealPending, true, 'недосмотренный перекус сохранён')
  assert.equal(behavior.debug().mealCooldownUntil, 0, 'недосмотренный перекус не запускает кулдаун')
  assert.equal(engine.activeAct(), null)
  assert.equal(engine.resolve(startedAt).animId, 'waitingCall')
})

test('короткое прерывание сохраняет показанный прогресс; достаточный показ запускает кулдаун', () => {
  const { behavior, engine, setTime, frame } = setup()
  behavior.applySnapshot(workSnapshot(), true, 1000)
  behavior.update(1000)
  const startedAt = advanceUntilMeal(behavior, 10_000, 1000 + 6 * 60 * 1000, 4000, setTime)
  assert.ok(startedAt !== null)
  const mealVariant = engine.activeAct().variantAnimId
  assert.ok(['snack', 'eatRice', 'sushiTray'].includes(mealVariant), 'выбран один из вариантов еды')

  for (let t = startedAt; t <= startedAt + 200; t += 100) frame(t)
  const interruptedAt = startedAt + 200
  setTime(interruptedAt)
  behavior.applySnapshot(waitingSnapshot(interruptedAt), true, interruptedAt)
  const firstShown = behavior.debug().mealShownMs
  assert.ok(firstShown < TEMPO.mealMinShownMs)
  assert.equal(behavior.debug().mealPending, true)
  assert.equal(behavior.debug().mealCooldownUntil, 0)

  const resumedAt = interruptedAt + 5000
  setTime(resumedAt)
  behavior.applySnapshot(workSnapshot(2), true, resumedAt)
  frame(resumedAt)
  assert.equal(behavior.debug().scene, 'meal', 'перекус возвращается только после разрешения запроса')
  assert.equal(engine.activeAct().elapsedOffset, firstShown, 'возвращается к уже показанному кадру')
  assert.equal(engine.activeAct().variantAnimId, mealVariant, 'после прерывания продолжается та же еда')
  assert.equal(behavior.debug().mealCooldownUntil, 0)

  const enoughShownAt = resumedAt + TEMPO.mealMinShownMs + 200
  for (let t = resumedAt + 100; t <= enoughShownAt; t += 100) frame(t)
  setTime(enoughShownAt)
  behavior.applySnapshot(waitingSnapshot(enoughShownAt), true, enoughShownAt)
  assert.equal(behavior.debug().mealPending, false, 'достаточно показанный перекус не ставится в очередь повторно')
  assert.ok(behavior.debug().mealCooldownUntil > enoughShownAt, 'кулдаун начинается только после достаточного показа')
  assert.equal(behavior.debug().workMs, 0, 'после полноценного перекуса рабочий стаж сброшен')
})

test('перекус не повторяется чаще кулдауна 12–20 минут', () => {
  const { behavior, setTime, frame } = setup()
  behavior.applySnapshot(workSnapshot(), true, 1000)
  behavior.update(1000)
  const startedAt = advanceUntilMeal(behavior, 10_000, 1000 + 6 * 60 * 1000, 4000, setTime)
  assert.ok(startedAt !== null, 'первый перекус')
  const initial = behavior.debug()
  for (let t = startedAt + 100; t <= initial.mealUntil + 100; t += 100) frame(t)
  const first = behavior.debug()
  const cooldownUntil = first.mealCooldownUntil
  // От конца перекуса до конца кулдауна сцена не повторяется, хотя стаж уже большой.
  for (let t = initial.mealUntil + 10; t <= cooldownUntil - 1000; t += 4000) {
    setTime(t)
    behavior.update(t)
    assert.equal(behavior.debug().mealUntil, 0, `перекус всплыл в кулдауне на ${t}`)
  }
  assert.ok(advanceUntilMeal(behavior, cooldownUntil, cooldownUntil + 8 * 60 * 1000, 4000, setTime) !== null,
    'после кулдауна и нового стажа — можно')
})

test('кошелёк: один раз после завершения, с кулдауном и без отмены', () => {
  const { engine, behavior } = setup()
  behavior.applySnapshot({ mood: 'running', activeSessions: 1 }, true, 1000)
  behavior.update(1000)
  behavior.applySnapshot({ mood: 'review', activeSessions: 0, until: 3600, navigation: { kind: 'review', targetRef: 's1' } }, true, 1000)
  const due = 3600 + TEMPO.reviewTailMs
  assert.equal(behavior.debug().walletAt, due, 'кошелёк запланирован после финишного жеста')
  behavior.update(due - 100)
  assert.equal(behavior.debug().scene, null)
  behavior.update(due + 1)
  assert.equal(behavior.debug().scene, 'wallet')
  assert.equal(engine.resolve(due + 1).animId, 'walletCheck')

  const walletEnd = behavior.debug().walletUntil
  behavior.update(walletEnd + 10)
  assert.equal(behavior.debug().scene, null, 'кошелёк убран, вернулись к покою')
  assert.ok(behavior.debug().walletCooldownUntil > walletEnd, 'кулдаун установлен')

  // Второе завершение сразу — кулдаун не даёт повторной сцены.
  behavior.applySnapshot({ mood: 'review', activeSessions: 0, until: walletEnd + 3000, navigation: { kind: 'review', targetRef: 's2' } }, true, walletEnd + 10)
  behavior.update(walletEnd + 3000 + TEMPO.reviewTailMs + 10)
  assert.equal(behavior.debug().scene, null, 'повторный кошелёк подавлен кулдауном')
})

test('новая работа отменяет отложенный кошелёк', () => {
  const { behavior } = setup()
  behavior.applySnapshot({ mood: 'review', activeSessions: 0, until: 3600, navigation: { kind: 'review', targetRef: 's1' } }, true, 1000)
  behavior.applySnapshot({ mood: 'running', activeSessions: 1 }, true, 2000)
  behavior.update(2000)
  assert.equal(behavior.debug().walletAt, 0, 'кошелёк не всплывёт посреди новой задачи')
})

test('настройки перекуса и кошелька уважаются', () => {
  const { behavior } = setup()
  behavior.features.meal = false
  behavior.features.wallet = false
  behavior.applySnapshot(workSnapshot(), true, 1000)
  behavior.update(1000)
  for (let t = 10_000; t <= 1000 + 8 * 60 * 1000; t += 10_000) behavior.update(t)
  assert.equal(behavior.debug().mealUntil, 0, 'перекусы выключены настройкой')
  const reviewAt = 1000 + 8 * 60 * 1000
  behavior.applySnapshot({ mood: 'review', activeSessions: 0, until: reviewAt + 2600, navigation: { kind: 'review', targetRef: 's1' } }, true, reviewAt)
  behavior.update(reviewAt + 2600 + TEMPO.reviewTailMs + 10)
  assert.equal(behavior.debug().scene, null, 'кошелёк выключен настройкой')
})
