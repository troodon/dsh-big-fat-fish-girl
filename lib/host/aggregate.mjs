// Choosing what to show when several tasks are alive.
//
// The plan is strict about one thing: the pose, the bubble and the click target are
// decided together. This module owns that single decision — which root task is the
// displayed one, which open request is pinned, and how many other requests wait.
// It knows nothing about art, DOM or Harness event names; it works on the plain
// structures built by lib/host/model.mjs.

/** Climb parent links to the user-facing root task. Orphans stand for themselves. */
export function rootTaskId(tasks, id) {
  let current = id
  const seen = new Set()
  while (current !== null && current !== undefined && !seen.has(current)) {
    seen.add(current)
    const task = tasks.get(current)
    if (task === undefined) return current
    if (task.parentId === null || !tasks.has(task.parentId)) return current
    current = task.parentId
  }
  return id
}

/** Group tasks by their root, keeping the newest activity per root. */
export function rootsOf(tasks) {
  const roots = new Map()
  for (const task of tasks.values()) {
    const id = rootTaskId(tasks, task.id)
    const record = roots.get(id) ?? {
      id,
      members: [],
      active: false,
      blocked: false,
      lastActivityAt: 0,
      subagents: 0,
    }
    record.members.push(task.id)
    if (task.subagent) record.subagents += 1
    if (task.lifecycle === 'active') record.active = true
    if (task.lifecycle === 'blocked') record.blocked = true
    record.lastActivityAt = Math.max(record.lastActivityAt, task.lastActivityAt ?? 0)
    roots.set(id, record)
  }
  return roots
}

/** Number of user-facing tasks currently doing work (subagents never add to it). */
export function activeRootCount(tasks) {
  let count = 0
  for (const root of rootsOf(tasks).values()) if (root.active) count += 1
  return count
}

/**
 * All open requests, oldest first. Each entry carries only what a click needs:
 * an opaque target ref (the session id), a kind and when it appeared.
 */
export function openAttention(model) {
  const items = []
  for (const [id, request] of model.approvals) {
    items.push({ id: `approval:${id}`, kind: 'approval', targetRef: request.taskId, since: request.since, phase: request.phase })
  }
  for (const [id, request] of model.questions) {
    items.push({ id: `question:${id}`, kind: 'question', targetRef: request.taskId, since: request.since, phase: null })
  }
  for (const task of model.tasks.values()) {
    if (task.lifecycle === 'blocked') {
      items.push({ id: `blocked:${task.id}`, kind: 'blocked', targetRef: task.id, since: task.blockedAt ?? task.lastActivityAt, phase: null })
    }
  }
  items.sort((a, b) => (a.since - b.since) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return items
}

/**
 * Token usage of the most recently observed root task, with subagents summed in exactly
 * once. Numbers only; no ids leave this function.
 */
export function usageSummary(tasks) {
  let best = null
  for (const root of rootsOf(tasks).values()) {
    let inputTokens = 0
    let outputTokens = 0
    let totalTokens = 0
    let observedAt = 0
    for (const memberId of root.members) {
      const usage = tasks.get(memberId)?.usage
      if (usage === null || usage === undefined) continue
      inputTokens += usage.inputTokens
      outputTokens += usage.outputTokens
      totalTokens += usage.totalTokens
      observedAt = Math.max(observedAt, usage.observedAt ?? 0)
    }
    if (observedAt > 0 && (best === null || observedAt > best.observedAt)) {
      best = { inputTokens, outputTokens, totalTokens, observedAt }
    }
  }
  return best
}

/** The root task whose work is shown: newest activity among active/blocked roots. */
export function selectedRoot(tasks, now = Date.now(), pinnedId = null) {
  const roots = rootsOf(tasks)
  const pinned = pinnedId === null ? undefined : roots.get(pinnedId)
  if (pinned !== undefined && (pinned.active || pinned.blocked)) return pinned
  let best = null
  for (const root of roots.values()) {
    if (!root.active && !root.blocked) continue
    if (best === null || root.lastActivityAt > best.lastActivityAt) best = root
  }
  return best
}

