// The host adapter is the only file that knows the Harness event vocabulary; these
// tests pin that vocabulary to what DeepSeek Harness 0.2.0-rc.2 actually emits.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  APPROVAL_OUTCOMES, HARNESS_APP, TRACKED_EVENTS, readSessionEvent, readSessionMeta,
  readTurnEnd, toolPhase,
} from '../lib/host/host-adapter.mjs'

const event = (type, data = {}) => ({ type, data })

test('версия контракта зафиксирована', () => {
  assert.equal(HARNESS_APP.version, '0.2.0-rc.2')
  assert.ok(TRACKED_EVENTS.includes('assistant/message'))
  assert.ok(TRACKED_EVENTS.includes('approval/asked'))
  assert.equal(TRACKED_EVENTS.includes('request/error'), false, 'таких событий нет в 0.2.0')
})

test('неизвестные события игнорируются, а не угадываются', () => {
  for (const type of ['message/delta', 'request/error', 'tool/error', 'response/error', 'session/title']) {
    assert.equal(readSessionEvent(event(type, { text: 'секрет' })), null, type)
  }
  assert.equal(readSessionEvent(null), null)
})

test('turn/end: все причины 0.2.0 разбираются точно', () => {
  assert.deepEqual(readTurnEnd({ kind: 'completed' }), { end: 'completed', cause: null })
  assert.deepEqual(readTurnEnd({ kind: 'blocked' }), { end: 'blocked', cause: null })
  assert.deepEqual(readTurnEnd({ kind: 'max-tokens' }), { end: 'max-tokens', cause: null })
  assert.deepEqual(readTurnEnd({ kind: 'interrupted' }), { end: 'interrupted', cause: null })
  assert.deepEqual(readTurnEnd({ kind: 'forked' }), { end: 'forked', cause: null })
  assert.deepEqual(readTurnEnd({ kind: 'error', error: { message: 'нет', code: 'e' } }), { end: 'error', cause: null })
  assert.deepEqual(readTurnEnd({ kind: 'aborted', reason: { kind: 'user' } }), { end: 'aborted', cause: 'user' })
  assert.deepEqual(readTurnEnd({ kind: 'aborted', reason: { kind: 'disposed' } }), { end: 'aborted', cause: 'disposed' })
  assert.deepEqual(readTurnEnd({ kind: 'aborted', reason: { kind: 'что-то' } }), { end: 'aborted', cause: null })
  assert.deepEqual(readTurnEnd('completed'), { end: 'completed', cause: null }, 'строка тоже допустима')
  assert.deepEqual(readTurnEnd({ kind: 'неизвестно' }), { end: 'unknown', cause: null })
  assert.deepEqual(readTurnEnd(undefined), { end: 'unknown', cause: null })
})

test('tool/call: фаза вместо имени, вопрос — это вопрос', () => {
  const call = readSessionEvent(event('tool/call', { callId: 7, name: 'str_replace_editor', arguments: '{"path":"/secret"}' }))
  assert.deepEqual(call, { kind: 'tool-call', callId: '7', phase: 'writing', question: false })
  assert.equal(JSON.stringify(call).includes('secret'), false, 'аргументы не проходят')
  assert.equal(JSON.stringify(call).includes('str_replace_editor'), false, 'имя не проходит')

  assert.equal(readSessionEvent(event('tool/call', { callId: 'q1', name: 'ask_user_question' })).question, true)
  assert.equal(readSessionEvent(event('tool/call', { callId: 'q2', name: 'request_user_input' })).question, true)
  assert.equal(readSessionEvent(event('tool/call', { name: 'bash' })), null, 'без callId пара не отслеживается')
})

test('tool/result закрывает вызов по callId и видит ошибку', () => {
  const ok = readSessionEvent(event('tool/result', { message: { source: { callId: 'c1' } } }))
  assert.deepEqual(ok, { kind: 'tool-result', callId: 'c1', failed: false })
  const failed = readSessionEvent(event('tool/result', { message: { source: { callId: 'c2' } }, error: { code: 'x' } }))
  assert.equal(failed.failed, true)
  assert.equal(readSessionEvent(event('tool/result', { message: {} })), null)
})

test('approvals: реальные outcome из словаря 0.2.0', () => {
  const asked = readSessionEvent(event('approval/asked', { id: 5, toolName: 'bash', callId: 'c1' }))
  assert.deepEqual(asked, { kind: 'approval-asked', id: '5', callId: 'c1', phase: 'commanding' })
  for (const outcome of APPROVAL_OUTCOMES) {
    assert.deepEqual(
      readSessionEvent(event('approval/decided', { id: '5', outcome })),
      { kind: 'approval-decided', id: '5', outcome },
    )
  }
  assert.equal(readSessionEvent(event('approval/decided', { id: '5', outcome: 'approved' })).outcome, null)
  assert.equal(readSessionEvent(event('approval/asked', {})), null)
})

test('assistant/message различает reasoning и ответ, не читая текст', () => {
  const reasoning = readSessionEvent(event('assistant/message', {
    stream: [{ type: 'reasoning-chunks', texts: ['очень секретно'] }],
  }))
  assert.deepEqual(reasoning, { kind: 'assistant-message', reasoning: true, text: false, usage: null })
  assert.equal(JSON.stringify(reasoning).includes('секретно'), false)

  const text = readSessionEvent(event('assistant/message', { stream: [{ type: 'text-chunks' }] }))
  assert.equal(text.text, true)
  assert.equal(text.reasoning, false)

  assert.deepEqual(readSessionEvent(event('assistant/attempt')), { kind: 'assistant-attempt' })
})

test('assistant/message: usage — только числа и только при наличии', () => {
  const withUsage = readSessionEvent(event('assistant/message', {
    stream: [{ type: 'text-chunks' }],
    usage: { inputTokens: 120, outputTokens: 30, cacheReadTokens: 1000 },
  }))
  assert.deepEqual(withUsage.usage, { inputTokens: 120, outputTokens: 30, totalTokens: 150 })
  assert.equal(readSessionEvent(event('assistant/message', { stream: [] })).usage, null)
  assert.equal(readSessionEvent(event('assistant/message', { usage: { inputTokens: 'много' } })).usage, null)
})

test('readSessionMeta достаёт корень и субагента из заголовка сессии', () => {
  assert.deepEqual(readSessionMeta({ id: 's1' }), { id: 's1', parentId: null, subagent: false, depth: 0 })
  assert.deepEqual(
    readSessionMeta({ header: { id: 'child', parentSession: 'root', origin: 'subagent', delegationDepth: 2 } }),
    { id: 'child', parentId: 'root', subagent: true, depth: 2 },
  )
})

test('фазы инструментов покрывают реальные семьи 0.2.0', () => {
  assert.equal(toolPhase('read_image'), 'reading')
  assert.equal(toolPhase('str_replace_editor'), 'writing')
  assert.equal(toolPhase('apply_patch'), 'writing')
  assert.equal(toolPhase('pwsh'), 'commanding')
  assert.equal(toolPhase('web_fetch'), 'browsing')
  assert.equal(toolPhase('todo_write'), 'planning')
  assert.equal(toolPhase('create_goal'), 'planning')
  assert.equal(toolPhase('schedule_create'), 'using')
})
