// The wire contract: what the host publishes and how every page reads it back. The field
// names, the defaults and the round trip are checked here once, for both halves.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { API_PREFIX, MOODS, SNAPSHOT_VERSION, normaliseSnapshot, sameSnapshot } from '../lib/protocol/contract.mjs'
import { DEFAULT_PREFS } from '../lib/settings/prefs.mjs'
import { applySessionEvent, createPetModel } from '../lib/host/model.mjs'
import { snapshotFor } from '../lib/host/snapshot.mjs'

const EMPTY = {
  mood: 'idle',
  waitingForUser: false,
  activeSessions: 0,
  until: 0,
  revision: 0,
  shellActive: false,
  phase: null,
  tool: null,
  attention: null,
  navigation: null,
  team: { active: 0, waiting: 0, completed: 0, errors: 0, coordinating: false },
  toolError: null,
  prefs: { ...DEFAULT_PREFS },
  usage: null,
}

test('the route prefix, the snapshot version and the moods are fixed', () => {
  assert.equal(API_PREFIX, '/big-fat-fish-girl/v1')
  assert.equal(SNAPSHOT_VERSION, 3)
  assert.ok(MOODS.includes('waiting') && MOODS.includes('idle'))
})

test('normaliseSnapshot turns anything into the one shape the pages use', () => {
  assert.deepEqual(normaliseSnapshot(null), EMPTY)
  assert.deepEqual(normaliseSnapshot('nope'), EMPTY)
  assert.deepEqual(normaliseSnapshot({}), EMPTY)
  assert.deepEqual(normaliseSnapshot({ mood: 'нет-такого', activeSessions: -5, until: 'x' }), EMPTY)
  assert.equal(normaliseSnapshot({ shellActive: true }).shellActive, true)
  assert.equal(normaliseSnapshot({ shellActive: 'да' }).shellActive, false, 'a string is not a flag')
})

test('waiting is the mood: a waitingForUser flag on the wire is not trusted', () => {
  assert.equal(normaliseSnapshot({ mood: 'waiting' }).waitingForUser, true)
  assert.equal(normaliseSnapshot({ mood: 'idle', waitingForUser: true }).waitingForUser, false)
})

test('phases, attention and targets must be valid; a tool phase is never an assistant phase', () => {
  assert.equal(normaliseSnapshot({ phase: 'composing' }).phase, 'composing')
  assert.equal(normaliseSnapshot({ phase: 'reading' }).phase, null)
  assert.deepEqual(
    normaliseSnapshot({ attention: { kind: 'approval', count: 2, targetRef: 's1' } }).attention,
    { kind: 'approval', count: 2, targetRef: 's1' },
  )
  assert.equal(normaliseSnapshot({ attention: { kind: 'approval', count: 0, targetRef: 's1' } }).attention, null)
  assert.equal(normaliseSnapshot({ navigation: { kind: 'task' } }).navigation, null)
})

test('tool phases and error signals keep only what the pages use', () => {
  assert.deepEqual(
    normaliseSnapshot({ tool: { phase: 'reading', until: 10, seq: 3, open: true } }).tool,
    { phase: 'reading', seq: 3, open: true },
  )
  assert.equal(normaliseSnapshot({ tool: {} }).tool, null)
  assert.equal(normaliseSnapshot({ tool: 'reading' }).tool, null)
  assert.equal(normaliseSnapshot({ tool: { phase: '' } }).tool, null)
  assert.deepEqual(
    normaliseSnapshot({ toolError: { id: '7', seq: 7, taskRef: 'opaque' } }).toolError,
    { id: '7', seq: 7 },
    'the pages never need the task ref',
  )
  assert.equal(normaliseSnapshot({ toolError: { id: '' } }).toolError, null)
})

test('team counts are never negative', () => {
  assert.deepEqual(
    normaliseSnapshot({ team: { active: 2, waiting: 1, completed: 3, errors: 4, coordinating: true } }).team,
    { active: 2, waiting: 1, completed: 3, errors: 4, coordinating: true },
  )
  assert.equal(normaliseSnapshot({ team: { active: -1 } }).team.active, 0)
})

test('usage passes only as numbers, with the total filled in', () => {
  assert.deepEqual(
    normaliseSnapshot({ usage: { inputTokens: 10, outputTokens: 5 } }).usage,
    { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
  )
  assert.equal(normaliseSnapshot({ usage: { inputTokens: 'да', outputTokens: 5 } }).usage, null)
  assert.equal(normaliseSnapshot({ usage: 'много' }).usage, null)
})

test('sameSnapshot compares what is on screen; a revision bump alone is not a change', () => {
  const a = normaliseSnapshot({ mood: 'running', activeSessions: 1, revision: 1 })
  assert.equal(sameSnapshot(a, normaliseSnapshot({ mood: 'running', activeSessions: 1, revision: 9 })), true)
  assert.equal(sameSnapshot(a, normaliseSnapshot({ mood: 'idle', activeSessions: 1 })), false)
  assert.equal(sameSnapshot(null, a), false)
  // Settings are part of the snapshot: changing them counts as a change.
  assert.equal(sameSnapshot(a, { ...a, prefs: { ...DEFAULT_PREFS, size: 96 } }), false)
})

test('what the host publishes is what the pages read back', () => {
  const model = createPetModel()
  applySessionEvent(model, 's1', { type: 'turn/start' }, 1000)
  applySessionEvent(model, 's1', { type: 'tool/call', data: { callId: 'c1', name: 'bash' } }, 1100)
  applySessionEvent(model, 's1', { type: 'approval/asked', data: { id: 'a1', toolName: 'bash' } }, 1200)
  const wire = JSON.parse(JSON.stringify(snapshotFor(model, 1300)))
  assert.deepEqual(Object.keys(wire).sort(), [
    'activeSessions', 'apiVersion', 'attention', 'mood', 'navigation', 'phase',
    'revision', 'team', 'tool', 'toolError', 'until', 'usage',
  ])
  const page = normaliseSnapshot(wire)
  assert.equal(page.mood, 'waiting')
  assert.equal(page.waitingForUser, true)
  assert.deepEqual(page.attention, wire.attention)
  assert.deepEqual(page.tool, { phase: 'commanding', seq: wire.tool.seq, open: true })
  assert.deepEqual(page.navigation, { kind: 'attention', targetRef: 's1' })
})
