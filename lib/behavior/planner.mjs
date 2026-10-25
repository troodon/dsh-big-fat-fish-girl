// Randomness and pacing, kept pure so it can be tested with a seeded generator
// and a fake clock. Nothing here touches the DOM, timers, or the network.

/** Deterministic PRNG (mulberry32). Same seed → same sequence, which is what the tests use. */
export function createRandom(seed = Date.now()) {
  let state = seed >>> 0
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Weighted pick. Entries with weight <= 0 are ignored; empty input returns null. */
export function pickWeighted(entries, random = Math.random) {
  const usable = (entries ?? []).filter((entry) => entry && typeof entry.weight === 'number' && entry.weight > 0)
  if (usable.length === 0) return null
  const total = usable.reduce((sum, entry) => sum + entry.weight, 0)
  let roll = random() * total
  for (const entry of usable) {
    roll -= entry.weight
    if (roll < 0) return entry
  }
  return usable[usable.length - 1]
}

/** Uniform float in [min, max); tolerates min > max by swapping. */
export function between(min, max, random = Math.random) {
  const low = Math.min(min, max)
  const high = Math.max(min, max)
  return low + random() * (high - low)
}

/**
 * Pacing for spontaneous behaviour.
 *
 * - idle acts fire after a quiet stretch, and any activity pushes the deadline back;
 * - hover acts are rate-limited so the pet does not twitch on every pointer move,
 *   with a short grace period so the first hover still feels alive.
 */
export function createActPlanner(options = {}) {
  const random = options.random ?? Math.random
  const idleMin = options.idleMinMs ?? 15000
  const idleMax = options.idleMaxMs ?? 45000
  // The first free scene waits a different (usually shorter) stretch than the later
  // ones: let her stand quietly at first, then keep a calm rhythm.
  const firstIdleMin = options.firstIdleMinMs ?? idleMin
  const firstIdleMax = options.firstIdleMaxMs ?? idleMax
  const hoverCooldown = options.hoverCooldownMs ?? 9000
  const workingMin = options.workingMinMs ?? 8000
  const workingMax = options.workingMaxMs ?? 18000

  let idleAt = Infinity
  let hoverAt = 0
  let workingAt = Infinity
  let started = false

  const scheduleIdle = (now, first = false) => {
    idleAt = now + (first ? between(firstIdleMin, firstIdleMax, random) : between(idleMin, idleMax, random))
  }
  const scheduleWorking = (now) => { workingAt = now + between(workingMin, workingMax, random) }

  return {
    /** A real event happened: push the idle deadline back. */
    markActivity(now) {
      started = true
      scheduleIdle(now)
    },
    /** Start the clock (first schedule) without pretending an event happened. */
    start(now) {
      if (started) return
      started = true
      // The first free scene uses its own (usually shorter) window; the first hover
      // is answered immediately, so the pet feels alive the moment you touch it.
      scheduleIdle(now, true)
      scheduleWorking(now)
      hoverAt = 0
    },
    /** True when a spontaneous act may play now; re-arms itself when it returns true. */
    idleDue(now) {
      if (!started || now < idleAt) return false
      scheduleIdle(now)
      return true
    },
    /**
     * True when the pet may show a spontaneous working animation (reading, typing,
     * using a tool) — paced more often than idle antics, because that is what she is
     * supposed to be doing while the model works.
     */
    workingDue(now) {
      if (!started || now < workingAt) return false
      scheduleWorking(now)
      return true
    },
    /** A hover reaction is allowed; re-arms the cooldown when it returns true. */
    hoverDue(now) {
      if (!started || now < hoverAt) return false
      hoverAt = now + between(hoverCooldown * 0.75, hoverCooldown * 1.25, random)
      return true
    },
    /** Next deadlines, for diagnostics and tests. */
    deadlines() {
      return { idleAt, hoverAt, workingAt }
    },
  }
}

/** Keep only the acts whose animation is actually loaded. */
export function availableActs(acts, isAvailable) {
  return (acts ?? []).filter((act) => act && isAvailable(act.anim))
}
