// The bubble decision: one text plus its pool, with the rotation memory that keeps a
// work phase from repeating itself. The controller owns the pose; this owns the words.
import { pickLine, teamStatusLine } from '../i18n/lines.mjs'
import { PHASE_POOLS, fixedLine, phaseKey } from './phases.mjs'

/** Phrases that stay until their state ends: they are anchors, not chatter. */
const FIXED_POOLS = new Set(['waiting', 'failed', 'limited', 'done'])

/**
 * Pools that get the amber treatment matching Harness's own approval notice: the user
 * is needed, something broke, or a change is being made to their system (files,
 * commands). Everything else keeps the neutral bubble.
 */
export const ALERT_POOLS = new Set(['waiting', 'failed', 'limited', 'editing', 'commanding', 'asking'])

/** Leave time to notice the bubble first, then read longer phrases. */
function readingTimeMs(text, tempo) {
  return Math.max(tempo.bubbleMs, Math.min(tempo.bubbleMaxMs, 1500 + [...text].length * tempo.bubbleCharMs))
}

/**
 * @param options.random seeded PRNG (tests)
 * @param options.tempo the pacing profile from the controller
 * @param options.locale `() => 'ru' | 'en' | 'zh-CN'`
 * @param options.snapshot `() => normalised snapshot`
 * @param options.isWaiting `() => boolean`
 * @param options.isProblem `(now) => boolean`
 * @param options.actualScene `() => scene id | null`
 * @param options.everydaySceneActive `() => boolean`
 * @param options.hoverUntil `() => timestamp` — also identifies one reaction
 * @param options.mealShown `(now) => boolean`
 * @param options.walletShown `(now) => boolean`
 * @param options.mealLine `() => string | null`
 * @param options.walletLine `() => string | null`
 * @returns `{ decide(now), reset(), pool() }`
 */
export function createBubbles({
  random, tempo, locale, snapshot, isWaiting, isProblem,
  actualScene, everydaySceneActive, hoverUntil, mealShown, walletShown,
  mealLine, walletLine,
}) {
  let line = null
  let linePool = null
  let lineUntil = 0
  let lineShownAt = 0
  let hoverToken = 0
  let hoverLine = null

  function show(text, pool, now) {
    if (text === null) return null
    line = text
    linePool = pool
    lineShownAt = now
    lineUntil = now + readingTimeMs(text, tempo)
    return { text, pool }
  }

  function showFixed(text, pool, now) {
    if (text === null) return null
    if (linePool === pool && line === text) return { text, pool }
    return show(text, pool, now)
  }

  /** One decision: `{ text, pool }`, or null when the bubble should hide. */
  function decide(now) {
    const snap = snapshot()
    if (isWaiting()) return { text: fixedLine(locale(), 'waiting'), pool: 'waiting' }
    if (isProblem(now)) return { text: fixedLine(locale(), snap.mood), pool: snap.mood }
    if (snap.mood === 'review' && snap.until > now) {
      return { text: fixedLine(locale(), 'done'), pool: 'done' }
    }
    // Ordinary updates cannot replace or hide a phrase before it has been read.
    // There is no queue: once this expires, only the latest snapshot is considered.
    if (line !== null && now < lineUntil) return { text: line, pool: linePool }
    const hoverEnd = hoverUntil()
    if (now < hoverEnd && actualScene() === null && !everydaySceneActive()) {
      if (hoverToken !== hoverEnd) {
        hoverToken = hoverEnd
        hoverLine = pickLine(locale(), 'hover', random, hoverLine)
      }
      return show(hoverLine, 'hover', now)
    }
    if (snap.mood === 'welcome' && snap.until > now) {
      return showFixed(fixedLine(locale(), 'welcome'), 'welcome', now)
    }
    // Keep the team context visible even while the scene owner is eating.
    const teamText = teamStatusLine(locale(), snap.team)
    if (mealShown(now)) {
      if (teamText !== null) return showFixed(teamText, 'team', now)
      const text = mealLine()
      return showFixed(text, 'meal', now)
    }
    if (walletShown(now)) {
      const text = walletLine()
      return showFixed(text, 'wallet', now)
    }
    if (teamText !== null) return showFixed(teamText, 'team', now)
    const key = phaseKey(snap)
    const pool = key === null
      ? (snap.phase !== null ? PHASE_POOLS[`assistant:${snap.phase}`] : null)
      : PHASE_POOLS[key]
    if (pool === undefined || pool === null) return null
    if (FIXED_POOLS.has(pool)) return { text: fixedLine(locale(), pool), pool }
    // The work phase may outlive one bubble: show it briefly, repeat rarely.
    if (linePool === pool && now - lineShownAt < tempo.bubbleCooldownMs) return null
    if (linePool !== pool || now >= lineUntil) {
      return show(pickLine(locale(), pool, random, linePool === pool ? line : null), pool, now)
    }
    return line === null ? null : { text: line, pool }
  }

  return {
    decide,
    reset() {
      line = null
      linePool = null
      lineUntil = 0
      hoverToken = 0
      hoverLine = null
    },
    pool() {
      return linePool
    },
  }
}
