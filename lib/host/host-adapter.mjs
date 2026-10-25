// The single place that knows the DeepSeek Harness event vocabulary.
//
// Verified against the installed DeepSeek Harness 0.2.0-rc.2 desktop bundle:
// `@deepseek-ai/dsh-desktop-runtime` 0.2.0-rc.2, event map in
// `@deepseek-ai/dsh-agent-preset-registry/lib/typert.host.js` (SessionEventMap).
//
// Rules:
// - Tool names, arguments, results and the text inside `assistant/message.stream`
//   never leave this file. Only meanings travel: a phase, a turn ending, usage counts.
// - Anything the installed version does not emit is not tracked here. Unknown events
//   are ignored instead of guessed.
// - When the contract changes, this file changes; the reducer and the renderer do not.

export const HARNESS_APP = Object.freeze({
  name: '@deepseek-ai/dsh-desktop',
  version: '0.2.0-rc.2',
  // The event contract was read from this package at the given version.
  eventMap: '@deepseek-ai/dsh-agent-preset-registry/lib/typert.host.js',
})

/** Session events this plugin listens to. Everything else is ignored on purpose. */
export const TRACKED_EVENTS = Object.freeze([
  'turn/start',
  'turn/end',
  'tool/call',
  'tool/result',
  'approval/asked',
  'approval/decided',
  'assistant/attempt',
  'assistant/message',
  'subagent/descriptor',
])

/** `TurnEndReasonMap` — exactly as declared by the installed version. */
export const TURN_END_KINDS = Object.freeze([
  'completed', 'aborted', 'blocked', 'error', 'max-tokens', 'interrupted', 'forked',
])

/** `AgentCancelCause` — who or what aborted the turn. */
export const CANCEL_CAUSES = Object.freeze(['user', 'parent', 'hook', 'disposed', 'legacy'])

/** `ApprovalOutcome` — exactly as declared by the installed version. */
export const APPROVAL_OUTCOMES = Object.freeze(['allowed-once', 'rejected', 'cancelled', 'unavailable'])

/**
 * Turn a tool name into a human phase. Privacy: only the phase ever leaves this file —
 * tool names, arguments and results are dropped here, so no prompt-adjacent text can
 * reach the browser. Anything unrecognised becomes "using".
 */
const TOOL_PHASES = Object.freeze([
  [/^(read|view|cat|open|show)/i, 'reading'],
  // Goal tools start with "create"/"update", so planning is matched before writing.
  [/^(todo|todo_write|plan|update_plan|create_goal|update_goal|get_goal)/i, 'planning'],
  [/^(write|edit|create|apply|patch|replace|str_replace)/i, 'writing'],
  [/^(grep|glob|search|find|list|ls|tree)/i, 'searching'],
  [/^(bash|shell|run|exec|terminal|command|pwsh)/i, 'commanding'],
  [/^(web_search|web_fetch|fetch|browse|curl)/i, 'browsing'],
  [/^(ask_user_question|ask|request_user_input)/i, 'asking'],
  [/^(task|agent|subagent|workflow|team)/i, 'delegating'],
])

export const ASKING_TOOLS = Object.freeze(['ask_user_question', 'request_user_input'])

export function toolPhase(name) {
  const value = typeof name === 'string' ? name : ''
  for (const [pattern, phase] of TOOL_PHASES) {
    if (pattern.test(value)) return phase
  }
  return 'using'
}

/** Whether a tool call is a question aimed at the user (it keeps the waiting state). */
export function isAskingTool(name) {
  return typeof name === 'string' && ASKING_TOOLS.includes(name)
}

function dataOf(event) {
  return event && typeof event.data === 'object' && event.data !== null ? event.data : {}
}

function stringOf(value) {
  return value === undefined || value === null ? null : String(value)
}

/** `turn/end.reason` as declared by TurnEndReasonMap, normalised to a flat outcome. */
export function readTurnEnd(reason) {
  const kind = typeof reason === 'string'
    ? reason
    : (reason && typeof reason === 'object' && typeof reason.kind === 'string' ? reason.kind : '')
  if (!TURN_END_KINDS.includes(kind)) return { end: 'unknown', cause: null }
  if (kind !== 'aborted') return { end: kind, cause: null }
  const raw = reason && typeof reason === 'object' ? reason.reason : null
  const cause = raw && typeof raw === 'object' && typeof raw.kind === 'string' ? raw.kind : null
  return { end: 'aborted', cause: CANCEL_CAUSES.includes(cause) ? cause : null }
}

/**
 * Token counts from one assistant message, if the provider reported them. Numbers only:
 * no model names, ids or content. `TokenUsage` in the installed Harness contract.
 */
export function readUsage(value) {
  if (value === null || typeof value !== 'object') return null
  const input = Number(value.inputTokens)
  const output = Number(value.outputTokens)
  if (!Number.isFinite(input) || !Number.isFinite(output)) return null
  const total = Number.isFinite(Number(value.totalTokens)) ? Number(value.totalTokens) : input + output
  return { inputTokens: input, outputTokens: output, totalTokens: total }
}

/** Whether an assistant stream record carries visible answer text or private reasoning. */
function streamKinds(stream) {
  let reasoning = false
  let text = false
  if (Array.isArray(stream)) {
    for (const record of stream) {
      if (record === null || typeof record !== 'object') continue
      if (record.type === 'reasoning-chunks') reasoning = true
      else if (record.type === 'text-chunks') text = true
    }
  }
  return { reasoning, text }
}

/**
 * Normalise one raw harness event into the small vocabulary the reducer understands.
 * Returns null for events this plugin deliberately does not track.
 *
 * @param event raw `session/event` payload
 * @returns {null | {
 *   kind: string, end?: string, cause?: string|null, callId?: string|null,
 *   phase?: string, question?: boolean, id?: string|null, outcome?: string|null,
 *   failed?: boolean, reasoning?: boolean, text?: boolean,
 * }}
 */
export function readSessionEvent(event) {
  if (event === null || typeof event !== 'object') return null
  const type = typeof event.type === 'string' ? event.type : ''
  const data = dataOf(event)

  switch (type) {
    case 'turn/start':
      return { kind: 'turn-start' }

    case 'turn/end': {
      const { end, cause } = readTurnEnd(data.reason)
      return { kind: 'turn-end', end, cause }
    }

    case 'tool/call': {
      const callId = stringOf(data.callId)
      if (callId === null) return null
      const name = typeof data.name === 'string' ? data.name : ''
      return {
        kind: 'tool-call',
        callId,
        phase: toolPhase(name),
        question: isAskingTool(name),
      }
    }

    case 'tool/result': {
      const source = data.message && typeof data.message === 'object' ? data.message.source : null
      const callId = stringOf(source && source.callId)
      if (callId === null) return null
      return { kind: 'tool-result', callId, failed: data.error !== undefined && data.error !== null }
    }

    case 'approval/asked': {
      const id = stringOf(data.id)
      if (id === null) return null
      return {
        kind: 'approval-asked',
        id,
        callId: stringOf(data.callId),
        phase: typeof data.toolName === 'string' ? toolPhase(data.toolName) : 'using',
      }
    }

    case 'approval/decided': {
      const id = stringOf(data.id)
      if (id === null) return null
      const outcome = typeof data.outcome === 'string' && APPROVAL_OUTCOMES.includes(data.outcome)
        ? data.outcome
        : null
      return { kind: 'approval-decided', id, outcome }
    }

    case 'assistant/attempt':
      return { kind: 'assistant-attempt' }

    case 'assistant/message': {
      const { reasoning, text } = streamKinds(data.stream)
      return { kind: 'assistant-message', reasoning, text, usage: readUsage(data.usage) }
    }

    case 'subagent/descriptor':
      return { kind: 'subagent' }

    default:
      return null
  }
}

/** Which configured task a live session belongs to (root task selection). */
export function readSessionMeta(session) {
  const header = session && typeof session === 'object' && session.header && typeof session.header === 'object'
    ? session.header
    : {}
  return {
    id: stringOf(header.id ?? session?.id),
    parentId: stringOf(header.parentSession),
    subagent: header.origin === 'subagent',
    depth: Number.isInteger(header.delegationDepth) ? header.delegationDepth : 0,
  }
}
