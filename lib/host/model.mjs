// Small, privacy-preserving reducer for the DeepSeek Harness session event stream.
//
// It keeps only transient session IDs and status edges; it never stores prompt,
// response, tool arguments, tool names or session titles. Tool names are reduced to
// phases inside lib/host/host-adapter.mjs — the only file that knows Harness event names.
//
// Verified against DeepSeek Harness 0.2.0-rc.2 (see docs/HARNESS-CONTRACT-v0.2.0-rc.2.md).
import {
  readSessionEvent, readSessionMeta,
} from './host-adapter.mjs'
import { activeRootCount, openAttention, rootTaskId, selectedRoot } from './aggregate.mjs'

export { toolPhase } from './host-adapter.mjs'

export const TRANSIENT_MS = Object.freeze({
  welcome: 1400,
  review: 2600,
  failed: 2400,
  // A token-limited stop is a quiet note, not a celebration and not a failure.
  limited: 3000,
})

/** How long "processing" / "composing" stays visible after an assistant event. */
export const ASSISTANT_PHASE_MS = 4000

/** The task state is internal; only phases and opaque refs ever leave snapshotFor. */
function createTask(id, meta, now) {
  return {
    id,
    parentId: meta.parentId,
    subagent: meta.subagent === true,
    depth: meta.depth,
    lifecycle: 'idle',
    openTools: new Map(),
    assistant: null, // { phase: 'processing'|'composing', until }
    usage: null,
    createdAt: now,
    lastActivityAt: now,
    blockedAt: null,
  }
}

// Call ids are unique, so a bounded window is enough to drop duplicate results and
// declined approvals without growing for the lifetime of a session.
const REMEMBERED_CALLS = 128

function rememberCall(set, key) {
  set.add(key)
  if (set.size > REMEMBERED_CALLS) set.delete(set.values().next().value)
}

export function createPetModel() {
  return {
    tasks: new Map(),
    approvals: new Map(), // id -> { taskId, since, phase }
    questions: new Map(), // callId -> { taskId, since }
    transient: null,
    toolSeq: 0,
    toolErrorSeq: 0,
    latestToolError: null,
    seenToolErrors: new Set(),
    dismissedToolCalls: new Set(),
    selectedRootId: null,
    revision: 0,
  }
}

function recordTransient(model, name, now, targetRef = null) {
  model.transient = { name, until: now + TRANSIENT_MS[name], targetRef }
}

function clearTransient(model) {
  model.transient = null
}

function taskFor(model, meta, now) {
  if (meta.id === null) return null
  let task = model.tasks.get(meta.id)
  if (task === undefined) {
    task = createTask(meta.id, meta, now)
    model.tasks.set(meta.id, task)
    model.revision += 1
  } else {
    // A session may reveal its parent only later; keep the link fresh.
    if (meta.parentId !== null) task.parentId = meta.parentId
    if (meta.subagent) task.subagent = true
  }
  return task
}

function touch(task, now) {
  task.lastActivityAt = now
}

function pruneTasks(model, now) {
  if (model.tasks.size <= 64) return
  const idle = [...model.tasks.values()]
    .filter((task) => task.lifecycle !== 'active' && task.lifecycle !== 'blocked' && task.openTools.size === 0)
    .sort((a, b) => a.lastActivityAt - b.lastActivityAt)
  for (const task of idle) {
    if (model.tasks.size <= 48) break
    model.tasks.delete(task.id)
  }
}

/** Any request waiting for the user keeps the waiting state until it is resolved. */
function attentionItems(model) {
  return openAttention(model)
}

function clearBlockedIfFree(model, taskId) {
  let hasApproval = false
  for (const request of model.approvals.values()) {
    if (request.taskId === taskId) hasApproval = true
  }
  const task = model.tasks.get(taskId)
  if (task !== undefined && task.lifecycle === 'blocked' && !hasApproval) {
    task.lifecycle = 'idle'
    task.blockedAt = null
  }
}

/** Drop the questions and approvals one task still holds; a finished turn cannot answer them. */
function clearRequests(model, taskId) {
  for (const [id, request] of model.approvals) {
    if (request.taskId === taskId) model.approvals.delete(id)
  }
  for (const [callId, request] of model.questions) {
    if (request.taskId === taskId) model.questions.delete(callId)
  }
}

/**
 * @param sessionRef a session id string (legacy) or the live session object
 *   `{ id, header }` handed to `session/event` listeners by Harness.
 */
export function applySessionEvent(model, sessionRef, event, now = Date.now()) {
  if (!model || !event || typeof event !== 'object') return model
  const session = sessionRef !== null && typeof sessionRef === 'object' ? sessionRef : { id: sessionRef }
  const meta = readSessionMeta(session)
  const normalised = readSessionEvent(event)
  if (normalised === null || meta.id === null) return model

  const task = taskFor(model, meta, now)
  model.revision += 1

  switch (normalised.kind) {
    case 'turn-start': {
      const wasQuiet = activeRootCount(model.tasks) === 0
      task.lifecycle = 'active'
      if (!task.subagent) model.selectedRootId = rootTaskId(model.tasks, task.id)
      else if (selectedRoot(model.tasks, now, model.selectedRootId) === null) model.selectedRootId = rootTaskId(model.tasks, task.id)
      task.blockedAt = null
      task.assistant = null
      touch(task, now)
      if (wasQuiet && attentionItems(model).length === 0) recordTransient(model, 'welcome', now)
      return model
    }

    case 'turn-end': {
      task.openTools.clear()
      task.assistant = null
      touch(task, now)
      // Only a blocked turn still waits for an answer. Any other ending takes its open
      // questions and approvals along, or the pet would wait forever for a dead request.
      if (normalised.end !== 'blocked') clearRequests(model, task.id)
      // A greeting belongs to a turn that started; it must not outlive it.
      if (model.transient !== null && model.transient.name === 'welcome') clearTransient(model)
      switch (normalised.end) {
        case 'blocked':
          task.lifecycle = 'blocked'
          task.blockedAt = now
          clearTransient(model)
          break
        case 'completed':
          task.lifecycle = 'completed'
          if (!task.subagent && activeRootCount(model.tasks) === 0
            && attentionItems(model).length === 0
            && model.transient === null) recordTransient(model, 'review', now, task.id)
          break
        case 'max-tokens':
          task.lifecycle = 'idle'
          if (attentionItems(model).length === 0) recordTransient(model, 'limited', now, task.id)
          break
        case 'error':
          task.lifecycle = 'failed'
          if (activeRootCount(model.tasks) === 0 && attentionItems(model).length === 0) recordTransient(model, 'failed', now, task.id)
          break
        case 'aborted':
          // Cancellation is not a failure. A user abort ends quietly; other causes
          // (parent, hook, disposal) are housekeeping, not a problem to report.
          task.lifecycle = normalised.cause === 'user' ? 'cancelled' : 'idle'
          break
        default:
          task.lifecycle = 'idle'
          break
      }
      pruneTasks(model, now)
      return model
    }

    case 'tool-call': {
      model.toolSeq += 1
      task.openTools.set(normalised.callId, {
        phase: normalised.phase,
        question: normalised.question,
        startedAt: now,
        seq: model.toolSeq,
      })
      if (normalised.question) {
        model.questions.set(normalised.callId, { taskId: task.id, since: now })
      }
      touch(task, now)
      return model
    }

    case 'tool-result': {
      const call = task.openTools.get(normalised.callId)
      task.openTools.delete(normalised.callId)
      model.questions.delete(normalised.callId)
      touch(task, now)
      clearBlockedIfFree(model, task.id)
      const errorId = `${task.id}:${normalised.callId}`
      const declined = model.dismissedToolCalls.has(errorId)
      model.dismissedToolCalls.delete(errorId)
      if (normalised.failed && call?.question !== true && !declined && !model.seenToolErrors.has(errorId)) {
        rememberCall(model.seenToolErrors, errorId)
        model.toolErrorSeq += 1
        model.latestToolError = { id: String(model.toolErrorSeq), seq: model.toolErrorSeq, taskId: task.id, at: now }
      }
      return model
    }

    case 'approval-asked': {
      model.approvals.set(normalised.id, { taskId: task.id, callId: normalised.callId, since: now, phase: normalised.phase })
      touch(task, now)
      return model
    }

    case 'approval-decided': {
      const approval = model.approvals.get(normalised.id)
      if (approval?.callId !== null && approval?.callId !== undefined && normalised.outcome !== 'allowed-once') {
        rememberCall(model.dismissedToolCalls, `${task.id}:${approval.callId}`)
      }
      model.approvals.delete(normalised.id)
      clearBlockedIfFree(model, task.id)
      touch(task, now)
      return model
    }

    case 'assistant-attempt': {
      task.assistant = { phase: 'processing', until: now + ASSISTANT_PHASE_MS }
      touch(task, now)
      return model
    }

    case 'assistant-message': {
      if (normalised.text) task.assistant = { phase: 'composing', until: now + ASSISTANT_PHASE_MS }
      else if (normalised.reasoning) task.assistant = { phase: 'processing', until: now + ASSISTANT_PHASE_MS }
      if (normalised.usage !== null && normalised.usage !== undefined) {
        const previous = task.usage ?? { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
        task.usage = {
          inputTokens: previous.inputTokens + normalised.usage.inputTokens,
          outputTokens: previous.outputTokens + normalised.usage.outputTokens,
          totalTokens: previous.totalTokens + normalised.usage.totalTokens,
          observedAt: now,
        }
      }
      touch(task, now)
      return model
    }

    case 'subagent': {
      task.subagent = true
      touch(task, now)
      return model
    }

    default:
      return model
  }
}

