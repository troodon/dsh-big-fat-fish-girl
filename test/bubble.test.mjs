import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createBubbles } from '../lib/behavior/bubble.mjs'
import { TEMPO } from '../lib/behavior/behavior.mjs'

test('a longer phrase keeps extra reading time without extending on every read', () => {
  let meal = true
  const text = 'Я немного перекушу, а потом вернусь помогать тебе с этой большой и интересной задачей.'
  const bubbles = createBubbles({
    random: () => 0, tempo: TEMPO, locale: () => 'ru',
    snapshot: () => ({ mood: 'idle', phase: null, tool: null, team: {} }),
    isWaiting: () => false, isProblem: () => false,
    actualScene: () => null, everydaySceneActive: () => meal,
    hoverUntil: () => 0, mealShown: () => meal, walletShown: () => false,
    mealLine: () => text, walletLine: () => null,
  })
  assert.equal(bubbles.decide(1000).text, text)
  meal = false
  assert.equal(bubbles.decide(1000 + TEMPO.bubbleMs).text, text, 'a long phrase survives more than the minimum')
  assert.equal(bubbles.decide(1000 + TEMPO.bubbleMaxMs), null, 'reading does not keep resetting its expiry')
})
