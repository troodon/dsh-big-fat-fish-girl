// Planner: randomness, weighting and pacing — all with an injected clock and RNG.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { availableActs, between, createActPlanner, createRandom, pickWeighted } from '../lib/behavior/planner.mjs'

test('createRandom детерминирован по seed', () => {
  const a = createRandom(42)
  const b = createRandom(42)
  const c = createRandom(43)
  const first = [a(), a(), a()]
  assert.deepEqual(first, [b(), b(), b()])
  assert.notDeepEqual(first, [c(), c(), c()])
  for (const value of first) assert.ok(value >= 0 && value < 1)
})

test('pickWeighted уважает веса, игнорирует мусор и пустой вход', () => {
  const entries = [{ id: 'a', weight: 1 }, { id: 'b', weight: 9 }]
  assert.equal(pickWeighted(entries, () => 0).id, 'a')
  assert.equal(pickWeighted(entries, () => 0.999).id, 'b')
  assert.equal(pickWeighted([{ id: 'a', weight: 0 }, { id: 'b', weight: -3 }], () => 0.5), null)
  assert.equal(pickWeighted([], () => 0.5), null)
  assert.equal(pickWeighted(undefined, () => 0.5), null)
})

test('between держит границы и переживает перевёрнутый диапазон', () => {
  assert.equal(between(10, 20, () => 0), 10)
  assert.equal(between(10, 20, () => 0.5), 15)
  assert.equal(between(20, 10, () => 0.5), 15)
})

test('планировщик: первый hover — сразу, idle — по таймеру, кулдауны соблюдаются', () => {
  const planner = createActPlanner({ random: () => 0.5, idleMinMs: 1000, idleMaxMs: 2000, hoverCooldownMs: 1000 })
  // до старта ничего не положено
  assert.equal(planner.hoverDue(0), false)
  assert.equal(planner.idleDue(0), false)

  planner.start(1000)
  assert.equal(planner.hoverDue(1000), true, 'первая реакция на наведение мгновенная')
  assert.equal(planner.hoverDue(1001), false, 'дальше — кулдаун')
  assert.equal(planner.hoverDue(1999), false)
  assert.equal(planner.hoverDue(2000), true)

  // idleAt = 1000 + between(1000,2000,0.5) = 2500, но hover не должен его сдвигать
  assert.equal(planner.idleDue(2499), false)
  assert.equal(planner.idleDue(2500), true)
  assert.equal(planner.idleDue(2501), false, 'после срабатывания таймер перезаводится')
})

test('активность отодвигает idle-выходку', () => {
  const planner = createActPlanner({ random: () => 0, idleMinMs: 1000, idleMaxMs: 1000 })
  planner.start(0)
  assert.equal(planner.idleDue(1000), true)
  planner.markActivity(5000)
  assert.equal(planner.idleDue(5999), false)
  assert.equal(planner.idleDue(6000), true)
})

test('availableActs отсеивает то, чего нет в арте', () => {
  const acts = [{ anim: 'wave', weight: 1 }, { anim: 'eatRice', weight: 1 }, null]
  const available = availableActs(acts, (anim) => anim !== 'eatRice')
  assert.deepEqual(available.map((act) => act.anim), ['wave'])
  assert.deepEqual(availableActs(undefined, () => true), [])
})

test('рабочие выходки идут чаще, чем простые, и перенастраиваются', () => {
  const planner = createActPlanner({ random: () => 0.5, idleMinMs: 20000, idleMaxMs: 20000, workingMinMs: 8000, workingMaxMs: 8000 })
  planner.start(0)
  assert.equal(planner.workingDue(1000), false, 'сразу после старта рано')
  assert.equal(planner.workingDue(8000), true, 'через рабочий интервал пора')
  assert.equal(planner.workingDue(8000), false, 'после срабатывания снова ждём')
  assert.equal(planner.deadlines().workingAt, 16000)
  // Активность сдвигает срок простых выходок, но НЕ рабочих: пока модель работает,
  // активность приходит каждый кадр, и рабочие анимации иначе не показывались бы вовсе.
  planner.markActivity(16000)
  assert.equal(planner.workingDue(16000), true, 'работа продолжает показывать, что она делает')
  assert.equal(planner.idleDue(16000), false, 'а простая выходка ждёт тишины')
  assert.equal(planner.deadlines().workingAt, 24000)
})
