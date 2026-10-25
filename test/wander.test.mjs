// Wandering: pacing, bounds, facing and determinism, all with an injected clock.
// Pacing is rare by design: one stroll every 20–40 minutes, at most two per rolling hour.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { between } from '../lib/behavior/planner.mjs'
import { clampTo, createWanderer } from '../lib/behavior/wander.mjs'

const fixed = (value) => () => value
const MIN = 60 * 1000
const HOUR = 60 * MIN

test('clampTo и between держат границы', () => {
  assert.equal(clampTo(5, { min: 0, max: 10 }), 5)
  assert.equal(clampTo(-3, { min: 0, max: 10 }), 0)
  assert.equal(clampTo(99, { min: 0, max: 10 }), 10)
  assert.equal(clampTo(5, { min: 10, max: 0 }), 5, 'перевёрнутый диапазон не ломает')
  assert.equal(between(10, 20, fixed(0)), 10)
  assert.equal(between(10, 20, fixed(1)), 20)
})

test('первая прогулка не начинается сразу: она ждёт свои 20–40 минут', () => {
  const wanderer = createWanderer({
    bounds: { min: 0, max: 500 },
    startX: 250,
    random: fixed(0.5),                                   // интервал = 30 минут
  })
  wanderer.step(0)
  assert.equal(wanderer.step(29 * MIN).walking, false, 'до срока она стоит')
  assert.equal(wanderer.step(30 * MIN + 1).walking, true, 'по сроку — идёт')
})

test('без места для прогулки питомец стоит', () => {
  const wanderer = createWanderer({ bounds: { min: 100, max: 100 }, startX: 100, random: fixed(0.5) })
  const first = wanderer.step(0)
  assert.equal(first.walking, false)
  assert.equal(first.dx, 0)
  const later = wanderer.step(60 * MIN)
  assert.equal(later.walking, false)
})

test('идёт к цели, разворачивается и останавливается на границе', () => {
  const wanderer = createWanderer({
    bounds: { min: 0, max: 100 },
    startX: 50,
    speedPxPerSec: 100,
    strollMinMs: 0,
    strollMaxMs: 0,
    random: fixed(1),                                     // цель = правый край
  })
  wanderer.step(0)
  const moves = []
  let now = 0
  for (let i = 0; i < 40; i += 1) {
    now += 100
    moves.push(wanderer.step(now))
  }
  const walking = moves.filter((move) => move.walking)
  assert.ok(walking.length > 0, 'должен идти')
  assert.ok(walking.some((move) => move.facing === 'right' && move.dx > 0), 'сначала вправо')
  for (const move of walking) {
    assert.equal(move.facing, move.dx < 0 ? 'left' : 'right', 'направление совпадает со знаком шага')
  }
  assert.ok(wanderer.position() >= 0 && wanderer.position() <= 100, 'не выходит за границы')
  assert.ok(new Set(walking.map((move) => move.facing)).size > 1, 'дойдя до края, идёт обратно')
})

test('направление меняется, когда цель слева', () => {
  const wanderer = createWanderer({
    bounds: { min: 0, max: 100 },
    startX: 50,
    speedPxPerSec: 100,
    strollMinMs: 0,
    strollMaxMs: 0,
    random: fixed(0),
  })
  wanderer.step(0)
  const move = wanderer.step(100)
  assert.equal(move.facing, 'left')
  assert.ok(move.dx < 0)
})

test('скорость соблюдается: за секунду не больше, чем разрешено', () => {
  const wanderer = createWanderer({
    bounds: { min: -1000, max: 1000 },
    startX: 0,
    speedPxPerSec: 40,
    strollMinMs: 0,
    strollMaxMs: 0,
    random: fixed(1),
  })
  wanderer.step(0)
  let moved = 0
  let now = 0
  for (let i = 0; i < 10; i += 1) {
    now += 100
    moved += Math.abs(wanderer.step(now).dx)
  }
  assert.ok(moved <= 40 + 0.001, `за 1 с прошёл ${moved} px при лимите 40`)
})

test('длинная пауза в кадре не превращается в прыжок', () => {
  const wanderer = createWanderer({
    bounds: { min: -500, max: 500 },
    startX: 0,
    speedPxPerSec: 100,
    strollMinMs: 0,
    strollMaxMs: 0,
    random: fixed(1),
  })
  wanderer.step(0)
  const jump = wanderer.step(10_000)                      // кадр через 10 секунд
  assert.ok(Math.abs(jump.dx) <= 25, `скачок ${jump.dx} px — кадр должен ограничиваться`)
})

test('setBounds пере-размечает дорожку и не выпускает за неё', () => {
  const wanderer = createWanderer({ bounds: { min: 0, max: 500 }, startX: 400, random: fixed(1) })
  wanderer.setBounds({ min: 0, max: 100 }, 0)
  assert.ok(wanderer.position() <= 100)
  assert.deepEqual(wanderer.bounds(), { min: 0, max: 100 })
})

test('setPosition синхронизирует позицию с реальным окном', () => {
  const wanderer = createWanderer({ bounds: { min: 0, max: 400 }, startX: 200, random: fixed(0.5) })
  wanderer.setPosition(320, 0)
  assert.equal(wanderer.position(), 320)
  wanderer.setPosition(9999, 0)                           // за границей — прижимается
  assert.equal(wanderer.position(), 400)
})

test('rest останавливает прогулку и откладывает следующую', () => {
  const wanderer = createWanderer({
    bounds: { min: 0, max: 1000 },
    startX: 0,
    speedPxPerSec: 100,
    strollMinMs: 5 * MIN,
    strollMaxMs: 5 * MIN,
    random: fixed(1),
  })
  wanderer.forceStroll(0)
  wanderer.step(0)
  wanderer.step(100)                                      // идёт
  wanderer.rest(200)
  const after = wanderer.step(300)
  assert.equal(after.walking, false)
  assert.equal(after.dx, 0)
  assert.equal(wanderer.step(200 + 5 * MIN - 1).walking, false, 'раньше срока не идёт')
  assert.equal(wanderer.step(200 + 5 * MIN + 1).walking, true, 'после срока — снова идёт')
})

test('forceStroll запускает прогулку немедленно, игнорируя ожидание', () => {
  const wanderer = createWanderer({ bounds: { min: 0, max: 500 }, startX: 250, random: fixed(0.5) })
  wanderer.step(0)
  assert.equal(wanderer.step(1000).walking, false)
  wanderer.forceStroll(2000)
  assert.equal(wanderer.step(2100).walking, true)
})

test('не больше двух стартов в любой скользящий час', () => {
  const wanderer = createWanderer({
    bounds: { min: 0, max: 50 },
    startX: 25,
    speedPxPerSec: 200,
    strollMinMs: 0,
    strollMaxMs: 0,
    maxPerHour: 2,
    random: fixed(1),
  })
  let now = 0
  wanderer.step(0)
  for (now = 100; now <= 2 * HOUR; now += 100) wanderer.step(now)
  const starts = wanderer.starts()
  // В любом окне длиной в час — не больше двух; за два часа их поэтому не больше четырёх.
  for (const start of starts) {
    const inWindow = starts.filter((at) => at >= start && at <= start + HOUR)
    assert.ok(inWindow.length <= 2, `в окне от ${start} оказалось ${inWindow.length} стартов`)
  }
  assert.ok(starts.length <= 4, `за два часа не больше четырёх стартов, получено ${starts.length}`)
  assert.ok(starts[2] - starts[0] >= HOUR, 'третий старт не раньше, чем через час после первого')
})

test('один и тот же вход даёт одно и то же поведение', () => {
  const make = () => createWanderer({
    bounds: { min: 0, max: 300 },
    startX: 150,
    speedPxPerSec: 60,
    strollMinMs: 0,
    strollMaxMs: 0,
    random: fixed(0.42),
  })
  const a = make()
  const b = make()
  const runA = []
  const runB = []
  for (let now = 0; now <= 3000; now += 250) {
    runA.push(a.step(now))
    runB.push(b.step(now))
  }
  assert.deepEqual(runA, runB)
})
