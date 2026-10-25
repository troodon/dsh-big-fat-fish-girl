// Wandering: the pet takes a rare stroll when nothing is happening.
//
// Pure and clock-injected like the rest of the core: it takes a time stamp and returns
// how far to move and which way to face. Whether that movement becomes a moved DOM
// element or a moved OS window is the caller's business, which is what lets the very
// same behaviour work in the page and on the desktop.
//
// Pacing is deliberately rare (plan §5.4): one stroll every 20–40 minutes, never more
// than two starts in any rolling hour. A stroll is a single leg to one target, then a
// long rest; hovering, work, requests and sleep postpone the next one.

import { between } from './planner.mjs'

export function clampTo(value, bounds) {
  const low = Math.min(bounds.min, bounds.max)
  const high = Math.max(bounds.min, bounds.max)
  return Math.min(high, Math.max(low, value))
}

const HOUR_MS = 60 * 60 * 1000

/**
 * @param options.bounds allowed range on the walking axis (a viewport or the screen)
 * @param options.speedPxPerSec walking speed
 * @param options.strollMinMs / options.strollMaxMs how long she stands between strolls
 *   (default 20–40 minutes: roughly the promised two per hour)
 * @param options.maxPerHour hard cap on stroll starts in any rolling hour (default 2)
 * @param options.startX where the pet currently is
 * @param options.random injectable RNG
 * @returns `{ setBounds, setPosition, position, walking, bounds, starts, step, rest, forceStroll }`
 */
export function createWanderer(options = {}) {
  const random = options.random ?? Math.random
  const speed = Math.max(1, options.speedPxPerSec ?? 42)
  // Legacy option names stay readable for callers of the old API.
  const strollMin = options.strollMinMs ?? options.pauseMinMs ?? 20 * 60 * 1000
  const strollMax = options.strollMaxMs ?? options.pauseMaxMs ?? 40 * 60 * 1000
  const maxPerHour = Number.isInteger(options.maxPerHour) ? Math.max(0, options.maxPerHour) : 2
  const arriveEpsilon = 0.5
  const maxStep = 0.25                                    // seconds; guards a stalled loop

  let bounds = options.bounds ?? { min: 0, max: 0 }
  let x = options.startX ?? clampTo(0, bounds)
  let target = x
  let facing = 'right'
  let lastAt = 0
  let nextStrollAt = null                                 // null until the first schedule
  let walking = false
  const starts = []                                       // when each stroll started

  const span = () => Math.abs(bounds.max - bounds.min)

  /** When the next stroll may begin: random interval, then the rolling-hour cap. */
  function nextStroll(now) {
    let candidate = now + between(strollMin, strollMax, random)
    if (maxPerHour > 0) {
      for (let guard = 0; guard < 8; guard += 1) {
        const recent = starts.filter((at) => at > candidate - HOUR_MS && at <= candidate)
        if (recent.length < maxPerHour) break
        candidate = recent[0] + HOUR_MS + 1              // wait for the oldest to age out
      }
    }
    return candidate
  }

  function pickTarget(now) {
    if (span() < 8) {                                     // nowhere to go
      target = x
      nextStrollAt = nextStroll(now)
      return false
    }
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const candidate = bounds.min + random() * span()
      if (Math.abs(candidate - x) > Math.min(60, span() * 0.35)) {
        target = candidate
        return true
      }
    }
    target = x < (bounds.min + bounds.max) / 2 ? bounds.max : bounds.min
    return Math.abs(target - x) >= arriveEpsilon
  }

  function stopAndSchedule(now) {
    walking = false
    target = x
    nextStrollAt = nextStroll(now)
  }

  /** Move one clock step towards the target; returns the signed delta (0 at the target). */
  function advance(dt) {
    const distance = target - x
    if (Math.abs(distance) < arriveEpsilon) return 0
    const dx = Math.sign(distance) * Math.min(Math.abs(distance), speed * dt)
    x = clampTo(x + dx, bounds)
    facing = dx < 0 ? 'left' : 'right'
    return dx
  }

  return {
    /** Re-range the walkway (viewport resized, screen changed, window moved). */
    setBounds(next, now = 0) {
      bounds = { min: next.min, max: next.max }
      x = clampTo(x, bounds)
      target = clampTo(target, bounds)
      if (!walking && nextStrollAt === null) nextStrollAt = nextStroll(now)
    },
    /** Force the current position (the shell reports the real window origin). */
    setPosition(value, now = 0) {
      x = clampTo(value, bounds)
      if (!walking && nextStrollAt === null) nextStrollAt = nextStroll(now)
    },
    position() {
      return x
    },
    walking() {
      return walking
    },
    bounds() {
      return { ...bounds }
    },
    /** When each stroll started — diagnostics and the rolling-hour tests. */
    starts() {
      return [...starts]
    },
    /**
     * Advance the stroll.
     * @returns `{ dx, facing, walking }` — dx is 0 while standing still.
     */
    step(now) {
      const dt = Math.min(maxStep, Math.max(0, (now - lastAt) / 1000))
      lastAt = now
      if (nextStrollAt === null) nextStrollAt = nextStroll(now)

      if (walking) {
        if (Math.abs(target - x) < arriveEpsilon) {
          stopAndSchedule(now)
          return { dx: 0, facing, walking }
        }
        return { dx: advance(dt), facing, walking: true }
      }

      if (now < nextStrollAt) return { dx: 0, facing, walking: false }
      const picked = pickTarget(now)
      if (!picked) return { dx: 0, facing, walking: false }
      walking = true
      starts.push(now)
      // Take the first step in this same frame, so a due stroll is visible at once.
      return { dx: advance(dt), facing, walking: true }
    },
    /** Stop where you are and postpone the next stroll. */
    rest(now = 0) {
      stopAndSchedule(now)
    },
    /** Start a stroll on the next step, ignoring the wait (self-tests, debug). */
    forceStroll(now = 0) {
      walking = false
      target = x
      nextStrollAt = now
    },
  }
}
