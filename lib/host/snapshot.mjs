// The wire snapshot: the only shape that leaves the host half. Field names and meanings are
// fixed by lib/protocol/contract.mjs, which every page normalises against. Categories, phases and
// statuses only: tool names, arguments, file paths and message text never appear here. The
// one identifier that can appear is the opaque `targetRef` of an open request or task.
import { activeRootCount, openAttention, selectedRoot, usageSummary } from './aggregate.mjs'
import { ASSISTANT_PHASE_MS } from './model.mjs'
import { SNAPSHOT_VERSION } from '../protocol/contract.mjs'

export function snapshotFor(model, now = Date.now()) {
  const attention = openAttention(model)
  const waiting = attention.length > 0
  const active = activeRootCount(model.tasks)

  let mood = 'idle'
  let until = 0
  if (waiting) mood = 'waiting'
  else if (model.transient !== null && model.transient.until > now) {
    mood = model.transient.name
    until = model.transient.until
  } else if (active > 0) mood = 'running'

  // Reading a snapshot must not change the model: the pinned root is re-checked on every
  // read, so a stale pin is simply ignored until the next turn starts.
  const root = selectedRoot(model.tasks, now, model.selectedRootId)
  let phase = null
  let tool = null
  if (root !== null) {
    let bestAt = -1
    let bestPhase = null
    let bestTool = null
    for (const memberId of root.members) {
      const task = model.tasks.get(memberId)
      if (task === undefined) continue
      let newest = null
      for (const call of task.openTools.values()) {
        if (newest === null || call.startedAt >= newest.startedAt) newest = call
      }
      if (newest !== null) {
        if (newest.startedAt >= bestAt) {
          bestAt = newest.startedAt
          bestPhase = newest.phase
          bestTool = newest
        }
      } else if (task.assistant !== null && task.assistant.until > now) {
        const at = task.assistant.until - ASSISTANT_PHASE_MS
        if (at >= bestAt) {
          bestAt = at
          bestPhase = task.assistant.phase
          bestTool = null
        }
      }
    }
    phase = bestPhase
    if (bestTool !== null) tool = { phase: bestTool.phase, seq: bestTool.seq, open: true }
  }

  const pinned = attention[0] ?? null

  // One click target for every surface. `navigation.targetRef` is an opaque session id,
  // never content; attention always outranks the plain task target.
  let navigation = null
  if (pinned !== null) navigation = { kind: 'attention', targetRef: pinned.targetRef }
  else if (model.transient !== null && model.transient.until > now && model.transient.targetRef !== null) {
    navigation = { kind: model.transient.name, targetRef: model.transient.targetRef }
  } else if (root !== null) navigation = { kind: 'task', targetRef: root.id }

  const waitingMembers = new Set()
  for (const task of model.tasks.values()) {
    if (task.lifecycle === 'blocked') waitingMembers.add(task.id)
  }
  for (const request of [...model.approvals.values(), ...model.questions.values()]) waitingMembers.add(request.taskId)
  const teamMembers = root === null ? [] : root.members
    .map((id) => model.tasks.get(id))
    .filter((task) => task?.subagent === true)
  const team = {
    active: teamMembers.filter((task) => task.lifecycle === 'active' && !waitingMembers.has(task.id)).length,
    waiting: teamMembers.filter((task) => waitingMembers.has(task.id)).length,
    completed: teamMembers.filter((task) => task.lifecycle === 'completed').length,
    errors: teamMembers.filter((task) => task.lifecycle === 'failed').length,
    coordinating: teamMembers.some((task) => task.lifecycle === 'active' && !waitingMembers.has(task.id)),
  }
  // Token counts only when the provider reported them; no cost, no balance.
  const usage = usageSummary(model.tasks)

  return Object.freeze({
    apiVersion: SNAPSHOT_VERSION,
    revision: model.revision,
    mood,
    activeSessions: active,
    until,
    phase,
    tool,
    attention: pinned === null ? null : { kind: pinned.kind, count: attention.length, targetRef: pinned.targetRef },
    team,
    toolError: model.latestToolError === null ? null : { id: model.latestToolError.id, seq: model.latestToolError.seq },
    navigation,
    usage: usage === null ? null : {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
    },
  })
}
