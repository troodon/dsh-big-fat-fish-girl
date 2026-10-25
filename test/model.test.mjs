// Reducer: turn endings, open tool lifecycles, attention pinning, subagents and the
// exact privacy boundary of the wire snapshot. The event vocabulary here mirrors
// DeepSeek Harness 0.2.0-rc.2 (see lib/host-adapter.mjs).
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ASSISTANT_PHASE_MS, applySessionEvent, createPetModel, toolPhase,
} from '../lib/host/model.mjs'
import { snapshotFor } from '../lib/host/snapshot.mjs'

const event = (type, data = {}) => ({ type, data })
const session = (id, header = {}) => ({ id, header: { id, isSeeded: false, ...header } })

test('starts quiet: idle v3 snapshot without identifiers', () => {
  const view = snapshotFor(createPetModel(), 10)
  assert.deepEqual(view, {
    apiVersion: 3,
    revision: 0,
    mood: 'idle',
    activeSessions: 0,
    until: 0,
    phase: null,
    tool: null,
    attention: null,
    team: { active: 0, waiting: 0, completed: 0, errors: 0, coordinating: false },
    toolError: null,
    navigation: null,
    usage: null,
  })
})

test('welcomes a new run, then settles into a working pose', () => {
  const model = createPetModel()
  applySessionEvent(model, 's1', event('turn/start'), 1000)
  assert.equal(snapshotFor(model, 1001).mood, 'welcome')
  assert.equal(snapshotFor(model, 2500).mood, 'running')
  assert.equal(snapshotFor(model, 2500).activeSessions, 1)
})

test('waiting has priority until the request is decided (real 0.2.0 outcomes)', () => {
  const model = createPetModel()
  applySessionEvent(model, 's1', event('approval/asked', { id: 'a1', toolName: 'bash' }), 1000)
  const waiting = snapshotFor(model, 1001)
  assert.equal(waiting.mood, 'waiting')
  assert.deepEqual(waiting.attention, { kind: 'approval', count: 1, targetRef: 's1' })
  applySessionEvent(model, 's1', event('approval/decided', { id: 'a1', outcome: 'allowed-once' }), 1200)
  assert.equal(snapshotFor(model, 1201).mood, 'idle')
  assert.equal(snapshotFor(model, 1201).attention, null)
})

test('an open ask-user-question keeps waiting; its result clears it', () => {
  const model = createPetModel()
  applySessionEvent(model, 's2', event('tool/call', { callId: 'q1', name: 'ask_user_question' }), 1000)
  assert.equal(snapshotFor(model, 1001).mood, 'waiting')
  assert.equal(snapshotFor(model, 1001).attention.kind, 'question')
  applySessionEvent(model, 's2', event('tool/result', { message: { source: { callId: 'q1' } } }), 1300)
  assert.equal(snapshotFor(model, 1301).mood, 'idle')
  assert.equal(snapshotFor(model, 1301).tool, null)
})

test('parallel tools live independently; the phase stays while any call is open', () => {
  const model = createPetModel()
  applySessionEvent(model, 's1', event('turn/start'), 0)
  applySessionEvent(model, 's1', event('tool/call', { callId: 'c1', name: 'read_file' }), 1000)
  applySessionEvent(model, 's1', event('tool/call', { callId: 'c2', name: 'str_replace_editor' }), 1100)
  assert.equal(snapshotFor(model, 1200).tool.phase, 'writing', 'самый свежий вызов виден')
  applySessionEvent(model, 's1', event('tool/result', { message: { source: { callId: 'c2' } } }), 1300)
  assert.equal(snapshotFor(model, 1400).tool.phase, 'reading', 'старый вызов ещё открыт')
  applySessionEvent(model, 's1', event('tool/result', { message: { source: { callId: 'c1' } } }), 1500)
  assert.equal(snapshotFor(model, 1600).tool, null)
})

test('a long tool call never expires on a timer', () => {
  const model = createPetModel()
  applySessionEvent(model, 's1', event('turn/start'), 0)
  applySessionEvent(model, 's1', event('tool/call', { callId: 'c1', name: 'bash' }), 1000)
  assert.equal(snapshotFor(model, 1000 + 60000).tool.phase, 'commanding')
  assert.equal(snapshotFor(model, 1000 + 600000).tool.open, true)
})

test('assistant attempt and answer text are distinguishable phases', () => {
  const model = createPetModel()
  applySessionEvent(model, 's1', event('turn/start'), 0)
  applySessionEvent(model, 's1', event('assistant/attempt'), 1000)
  assert.equal(snapshotFor(model, 1100).phase, 'processing')
  applySessionEvent(model, 's1', event('assistant/message', { stream: [{ type: 'text-chunks' }] }), 2000)
  assert.equal(snapshotFor(model, 2100).phase, 'composing')
  assert.equal(snapshotFor(model, 2000 + ASSISTANT_PHASE_MS + 1).phase, null)
})

test('a user abort is cancelled, not failed, and never celebrates', () => {
  const model = createPetModel()
  applySessionEvent(model, 's1', event('turn/start'), 1000)
  applySessionEvent(model, 's1', event('turn/end', { reason: { kind: 'aborted', reason: { kind: 'user' } } }), 1200)
  const view = snapshotFor(model, 1300)
  assert.equal(view.mood, 'idle')
  assert.equal(view.activeSessions, 0)
})

test('housekeeping aborts (parent, hook, disposed) stay neutral', () => {
  for (const cause of ['parent', 'hook', 'disposed', 'legacy']) {
    const model = createPetModel()
    applySessionEvent(model, 's1', event('turn/start'), 1000)
    applySessionEvent(model, 's1', event('turn/end', { reason: { kind: 'aborted', reason: { kind: cause } } }), 1200)
    assert.equal(snapshotFor(model, 1300).mood, 'idle', `причина ${cause} не должна пугать`)
  }
})

test('a finished turn releases its open question and approval', () => {
  const model = createPetModel()
  applySessionEvent(model, 's1', event('turn/start'), 1000)
  applySessionEvent(model, 's1', event('tool/call', { callId: 'q1', name: 'ask_user_question' }), 1100)
  applySessionEvent(model, 's1', event('approval/asked', { id: 'a1', toolName: 'bash' }), 1150)
  applySessionEvent(model, 's1', event('turn/end', { reason: { kind: 'aborted', reason: { kind: 'user' } } }), 1200)
  const view = snapshotFor(model, 1300)
  assert.equal(view.mood, 'idle')
  assert.notEqual(view.mood, 'waiting')
  assert.equal(view.attention, null)
})

test('a blocked turn keeps waiting for its approval', () => {
  const model = createPetModel()
  applySessionEvent(model, 's1', event('turn/start'), 1000)
  applySessionEvent(model, 's1', event('approval/asked', { id: 'a1', toolName: 'bash' }), 1100)
  applySessionEvent(model, 's1', event('turn/end', { reason: 'blocked' }), 1200)
  const view = snapshotFor(model, 1300)
  assert.equal(view.mood, 'waiting')
  assert.equal(view.attention.kind, 'approval')
})

test('reading a snapshot leaves the model untouched', () => {
  const model = createPetModel()
  applySessionEvent(model, 's1', event('turn/start'), 1000)
  applySessionEvent(model, 's1', event('turn/end', { reason: 'completed' }), 1200)
  const before = model.selectedRootId
  snapshotFor(model, 5000)
  assert.equal(model.selectedRootId, before)
})

test('token limit is a quiet note, not a review celebration', () => {
  const model = createPetModel()
  applySessionEvent(model, 's1', event('turn/start'), 1000)
  applySessionEvent(model, 's1', event('turn/end', { reason: { kind: 'max-tokens' } }), 1200)
  assert.equal(snapshotFor(model, 1300).mood, 'limited')
})

test('interrupted and forked endings are neutral; error is a real problem', () => {
  const interrupted = createPetModel()
  applySessionEvent(interrupted, 's1', event('turn/start'), 1000)
  applySessionEvent(interrupted, 's1', event('turn/end', { reason: { kind: 'interrupted' } }), 1200)
  assert.equal(snapshotFor(interrupted, 1300).mood, 'idle')

  const forked = createPetModel()
  applySessionEvent(forked, 's1', event('turn/start'), 1000)
  applySessionEvent(forked, 's1', event('turn/end', { reason: { kind: 'forked' } }), 1200)
  assert.equal(snapshotFor(forked, 1300).mood, 'idle')

  const failed = createPetModel()
  applySessionEvent(failed, 's1', event('turn/start'), 1000)
  applySessionEvent(failed, 's1', event('turn/end', { reason: { kind: 'error', error: { message: 'нет', code: 'e' } } }), 1200)
  assert.equal(snapshotFor(failed, 1300).mood, 'failed')
  assert.equal(snapshotFor(failed, 5000).mood, 'idle')
})

test('problem waits behind an open request: attention wins the mood', () => {
  const model = createPetModel()
  applySessionEvent(model, 's1', event('turn/start'), 1000)
  applySessionEvent(model, 's2', event('approval/asked', { id: 'a1' }), 1100)
  applySessionEvent(model, 's1', event('turn/end', { reason: { kind: 'error' } }), 1200)
  assert.equal(snapshotFor(model, 1300).mood, 'waiting')
})

test('blocked turn end waits, and the next turn start clears it', () => {
  const model = createPetModel()
  applySessionEvent(model, 's1', event('turn/start'), 1000)
  applySessionEvent(model, 's1', event('turn/end', { reason: { kind: 'blocked' } }), 1100)
  assert.equal(snapshotFor(model, 1200).mood, 'waiting')
  assert.deepEqual(snapshotFor(model, 1200).attention, { kind: 'blocked', count: 1, targetRef: 's1' })
  applySessionEvent(model, 's1', event('turn/start'), 1300)
  assert.equal(snapshotFor(model, 1400).mood, 'welcome')
})

test('two requests pin the oldest; resolving it pins the next', () => {
  const model = createPetModel()
  applySessionEvent(model, 's1', event('approval/asked', { id: 'a1' }), 1000)
  applySessionEvent(model, 's2', event('approval/asked', { id: 'a2' }), 1100)
  const first = snapshotFor(model, 1200)
  assert.equal(first.attention.count, 2)
  assert.equal(first.attention.targetRef, 's1', 'закреплён самый старый')
  assert.equal(first.attention.kind, 'approval')
  applySessionEvent(model, 's1', event('approval/decided', { id: 'a1', outcome: 'rejected' }), 1300)
  const second = snapshotFor(model, 1400)
  assert.equal(second.attention.count, 1)
  assert.equal(second.attention.targetRef, 's2')
})

test('subagents fold into the root task and never inflate the count', () => {
  const model = createPetModel()
  applySessionEvent(model, 'root', event('turn/start'), 1000)
  applySessionEvent(model, session('child', { parentSession: 'root', origin: 'subagent', delegationDepth: 1 }), event('turn/start'), 1100)
  assert.equal(snapshotFor(model, 1200).activeSessions, 1, 'дочерняя сессия не отдельная задача')
  assert.equal(snapshotFor(model, 2600).mood, 'running', 'приветствие живёт коротко')

  // Субагент завершился — корневая работа продолжается.
  applySessionEvent(model, session('child', { parentSession: 'root', origin: 'subagent' }), event('turn/end', { reason: { kind: 'completed' } }), 2700)
  assert.equal(snapshotFor(model, 2800).activeSessions, 1, 'конец субагента не завершает корень')
  assert.equal(snapshotFor(model, 2800).mood, 'running', 'и не запускает праздник всей работы')
})

test('finishing one task while another runs does not celebrate the whole job', () => {
  const model = createPetModel()
  applySessionEvent(model, 's1', event('turn/start'), 1000)
  applySessionEvent(model, 's2', event('turn/start'), 1100)
  applySessionEvent(model, 's1', event('turn/end', { reason: { kind: 'completed' } }), 2000)
  const view = snapshotFor(model, 2001)
  assert.notEqual(view.mood, 'review')
  assert.equal(view.mood, 'running')
  assert.equal(view.activeSessions, 1)
})

test('tool names are classified by the verified 0.2.0 vocabulary', () => {
  assert.equal(toolPhase('read_file'), 'reading')
  assert.equal(toolPhase('read_image'), 'reading')
  assert.equal(toolPhase('grep'), 'searching')
  assert.equal(toolPhase('write_file'), 'writing')
  assert.equal(toolPhase('str_replace_editor'), 'writing')
  assert.equal(toolPhase('apply_patch'), 'writing')
  assert.equal(toolPhase('bash'), 'commanding')
  assert.equal(toolPhase('pwsh'), 'commanding')
  assert.equal(toolPhase('web_search'), 'browsing')
  assert.equal(toolPhase('web_fetch'), 'browsing')
  assert.equal(toolPhase('ask_user_question'), 'asking')
  assert.equal(toolPhase('request_user_input'), 'asking')
  assert.equal(toolPhase('task'), 'delegating')
  assert.equal(toolPhase('subagent'), 'delegating')
  assert.equal(toolPhase('todo_write'), 'planning')
  assert.equal(toolPhase('create_goal'), 'planning')
  assert.equal(toolPhase('schedule_create'), 'using')
  assert.equal(toolPhase('что-то-новое'), 'using')
  assert.equal(toolPhase(undefined), 'using')
})

test('usage: шаги складываются, субагент учитывается в корне один раз', () => {
  const model = createPetModel()
  applySessionEvent(model, 's1', event('turn/start'), 0)
  applySessionEvent(model, 's1', event('assistant/message', { stream: [{ type: 'reasoning-chunks' }], usage: { inputTokens: 100, outputTokens: 20 } }), 1000)
  applySessionEvent(model, 's1', event('assistant/message', { stream: [{ type: 'text-chunks' }], usage: { inputTokens: 50, outputTokens: 30, totalTokens: 90 } }), 2000)
  applySessionEvent(model, session('child', { parentSession: 's1', origin: 'subagent' }), event('assistant/message', { stream: [{ type: 'text-chunks' }], usage: { inputTokens: 10, outputTokens: 5 } }), 3000)
  const usage = snapshotFor(model, 3100).usage
  assert.deepEqual(usage, { inputTokens: 160, outputTokens: 55, totalTokens: 225 }, 'числа без имён и id')

  const done = createPetModel()
  applySessionEvent(done, 's1', event('turn/start'), 0)
  applySessionEvent(done, 's1', event('turn/end', { reason: { kind: 'completed' } }), 1000)
  assert.equal(snapshotFor(done, 1100).usage, null, 'без данных usage — null, а не нули')
})

test('team snapshots reflect helper lifecycle and keep a stable active root pinned', () => {
  const model = createPetModel()
  applySessionEvent(model, 'root-a', event('turn/start'), 1000)
  applySessionEvent(model, 'root-b', event('turn/start'), 1100)
  applySessionEvent(model, session('helper-a', { parentSession: 'root-a', origin: 'subagent', delegationDepth: 1 }), event('turn/start'), 1200)

  const pinned = snapshotFor(model, 1300)
  assert.equal(pinned.navigation.targetRef, 'root-b', 'new active root remains pinned despite helper activity')
  assert.deepEqual(pinned.team, { active: 0, waiting: 0, completed: 0, errors: 0, coordinating: false }, 'helpers from another root are not mixed in')

  applySessionEvent(model, 'root-b', event('turn/end', { reason: { kind: 'completed' } }), 1400)
  const fallback = snapshotFor(model, 1500)
  assert.equal(fallback.navigation.targetRef, 'root-a', 'when the pinned root completes, select the remaining active root')
  assert.deepEqual(fallback.team, { active: 1, waiting: 0, completed: 0, errors: 0, coordinating: true })

  applySessionEvent(model, session('helper-a', { parentSession: 'root-a', origin: 'subagent' }), event('approval/asked', { id: 'approval-a' }), 1600)
  assert.deepEqual(snapshotFor(model, 1700).team, { active: 0, waiting: 1, completed: 0, errors: 0, coordinating: false })
  applySessionEvent(model, session('helper-a', { parentSession: 'root-a', origin: 'subagent' }), event('approval/decided', { id: 'approval-a', outcome: 'allowed-once' }), 1800)
  applySessionEvent(model, session('helper-a', { parentSession: 'root-a', origin: 'subagent' }), event('turn/end', { reason: { kind: 'completed' } }), 1900)
  assert.deepEqual(snapshotFor(model, 2000).team, { active: 0, waiting: 0, completed: 1, errors: 0, coordinating: false })
})

test('only failed tool results create a stable tool-error signal; approvals and duplicates do not', () => {
  const model = createPetModel()
  applySessionEvent(model, 's1', event('turn/start'), 1000)
  applySessionEvent(model, 's1', event('tool/call', { callId: 'ok', name: 'bash' }), 1100)
  applySessionEvent(model, 's1', event('tool/result', { message: { source: { callId: 'ok' } } }), 1200)
  assert.equal(snapshotFor(model, 1250).toolError, null, 'successful result has no error reaction')

  applySessionEvent(model, 's1', event('tool/call', { callId: 'bad', name: 'bash' }), 1300)
  applySessionEvent(model, 's1', event('tool/result', { message: { source: { callId: 'bad' } }, error: { message: 'private output' } }), 1400)
  const failed = snapshotFor(model, 1500)
  assert.deepEqual(failed.toolError, { id: '1', seq: 1 })
  assert.equal(JSON.stringify(failed).includes('private output'), false)
  assert.equal(JSON.stringify(failed).includes('bash'), false)

  applySessionEvent(model, 's1', event('tool/result', { message: { source: { callId: 'bad' } }, error: { message: 'duplicate' } }), 1600)
  assert.deepEqual(snapshotFor(model, 1700).toolError, failed.toolError, 'duplicate result is deduplicated')

  applySessionEvent(model, 's1', event('tool/call', { callId: 'declined', name: 'bash' }), 1800)
  applySessionEvent(model, 's1', event('approval/asked', { id: 'a1', callId: 'declined', toolName: 'bash' }), 1850)
  applySessionEvent(model, 's1', event('approval/decided', { id: 'a1', outcome: 'rejected' }), 1900)
  applySessionEvent(model, 's1', event('tool/result', { message: { source: { callId: 'declined' } }, error: { message: 'declined' } }), 2000)
  assert.deepEqual(snapshotFor(model, 2100).toolError, failed.toolError, 'user refusal is not a tool execution failure')
})

test('the snapshot leaks no tool names or arguments; only an opaque navigation ref', () => {
  const model = createPetModel()
  applySessionEvent(model, 'session-secret', event('turn/start'), 0)
  applySessionEvent(model, 'session-secret', event('tool/call', {
    callId: 'c1',
    name: 'read_file',
    arguments: { path: '/секрет/план.txt' },
  }), 1000)
  const view = snapshotFor(model, 1100)
  const serialised = JSON.stringify(view)
  assert.equal(view.tool.phase, 'reading')
  assert.equal(view.tool.open, true)
  assert.equal(serialised.includes('read_file'), false)
  assert.equal(serialised.includes('секрет'), false)
  // Навигационная цель — это непрозрачный id сессии, и только он: документированное
  // расширение приватности из плана (клик обязан открывать нужный чат).
  assert.deepEqual(view.navigation, { kind: 'task', targetRef: 'session-secret' })

  // Обращение перекрывает рабочую цель и закрепляется.
  applySessionEvent(model, 'session-secret', event('approval/asked', { id: 'a1' }), 1200)
  const waiting = snapshotFor(model, 1300)
  assert.equal(waiting.attention.targetRef, 'session-secret')
  assert.deepEqual(waiting.navigation, { kind: 'attention', targetRef: 'session-secret' })
})
