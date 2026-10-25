// The wire contract: the one place that says what the host publishes and what the pages
// accept. The host builds snapshots against these names, and every page normalises what it
// receives through the same function, so a field cannot drift between the two sides.
//
// Bundle-safe on purpose: no Node or DOM imports, so the browser bundle uses it unchanged.
import { normalisePrefs, samePrefs } from '../settings/prefs.mjs'

/** Path prefix of every route the plugin serves. */
export const API_PREFIX = '/big-fat-fish-girl/v1'
/** The snapshot shape the host publishes. Bump it when a field changes its meaning. */
export const SNAPSHOT_VERSION = 3

/** Moods the host can publish; anything else reads as idle. */
export const MOODS = Object.freeze(['idle', 'running', 'waiting', 'welcome', 'review', 'failed', 'limited'])

/** Assistant phases. Tool phases travel in `tool.phase`, so `phase` never names a tool. */
export const ASSISTANT_PHASES = Object.freeze(['processing', 'composing'])

function objectOrNull(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null
}

function shortString(value) {
  return typeof value === 'string' && value !== '' ? value : null
}

function count(value) {
  return Number.isInteger(value) && value > 0 ? value : 0
}

function usageShape(value) {
  const source = objectOrNull(value)
  if (source === null) return null
  const inputTokens = Number(source.inputTokens)
  const outputTokens = Number(source.outputTokens)
  const totalTokens = Number(source.totalTokens)
  if (!Number.isFinite(inputTokens) || !Number.isFinite(outputTokens)) return null
  return {
    inputTokens,
    outputTokens,
    totalTokens: Number.isFinite(totalTokens) ? totalTokens : inputTokens + outputTokens,
  }
}

/**
 * Turn anything the host sends into the one shape the pages work with. Unknown fields are
 * dropped and bad values fall back to defaults. `waitingForUser` is derived from the mood:
 * the host publishes the mood only, so a flag of that name on the wire is ignored.
 */
export function normaliseSnapshot(input) {
  // Anything that is not an object reads as an empty snapshot: every field takes its default.
  const value = input !== null && typeof input === 'object' ? input : {}
  const mood = MOODS.includes(value.mood) ? value.mood : 'idle'
  const tool = objectOrNull(value.tool)
  const attention = objectOrNull(value.attention)
  const navigation = objectOrNull(value.navigation)
  const team = objectOrNull(value.team)
  const toolError = objectOrNull(value.toolError)
  return {
    mood,
    waitingForUser: mood === 'waiting',
    activeSessions: Number.isFinite(value.activeSessions) ? Math.max(0, value.activeSessions) : 0,
    until: Number.isFinite(value.until) ? value.until : 0,
    revision: Number.isInteger(value.revision) && value.revision >= 0 ? value.revision : 0,
    // True while a desktop shell page is connected: the in-page overlay steps aside.
    shellActive: value.shellActive === true,
    phase: ASSISTANT_PHASES.includes(value.phase) ? value.phase : null,
    tool: tool !== null && shortString(tool.phase) !== null
      ? { phase: tool.phase, seq: Number.isFinite(tool.seq) ? tool.seq : 0, open: tool.open === true }
      : null,
    attention: attention !== null
      && shortString(attention.kind) !== null
      && Number.isInteger(attention.count) && attention.count > 0
      && shortString(attention.targetRef) !== null
      ? { kind: attention.kind, count: attention.count, targetRef: attention.targetRef }
      : null,
    // An opaque ref: the only identifier that crosses the wire, and only while it is open.
    navigation: navigation !== null && shortString(navigation.kind) !== null && shortString(navigation.targetRef) !== null
      ? { kind: navigation.kind, targetRef: navigation.targetRef }
      : null,
    team: {
      active: count(team?.active),
      waiting: count(team?.waiting),
      completed: count(team?.completed),
      errors: count(team?.errors),
      coordinating: team?.coordinating === true,
    },
    toolError: toolError !== null && shortString(toolError.id) !== null
      ? { id: toolError.id, seq: Number.isFinite(toolError.seq) ? toolError.seq : 0 }
      : null,
    // The plugin settings as the host holds them; missing values fall back to the defaults.
    prefs: normalisePrefs(value.prefs),
    usage: usageShape(value.usage),
  }
}

/** Whether two normalised snapshots look identical on screen; revisions alone do not count. */
export function sameSnapshot(a, b) {
  if (a === null || b === null) return false
  const aTool = a.tool ?? null
  const bTool = b.tool ?? null
  return a.mood === b.mood
    && a.activeSessions === b.activeSessions
    && a.shellActive === b.shellActive
    && a.phase === b.phase
    && (aTool === null ? bTool === null : bTool !== null && aTool.phase === bTool.phase && aTool.seq === bTool.seq && aTool.open === bTool.open)
    && (a.attention?.targetRef ?? null) === (b.attention?.targetRef ?? null)
    && (a.navigation?.targetRef ?? null) === (b.navigation?.targetRef ?? null)
    && ['active', 'waiting', 'completed', 'errors', 'coordinating'].every((key) => a.team?.[key] === b.team?.[key])
    && (a.toolError?.id ?? null) === (b.toolError?.id ?? null)
    && samePrefs(normalisePrefs(a.prefs), normalisePrefs(b.prefs))
}
