// The everyday scenes: the snack after a long stretch of work, and the wallet check after a
// finished job. Both are timed by the work they follow, never by a schedule, and both wait
// for quiet: a request, a problem or a tool error pauses them. The behaviour controller owns
// the poses and the bubble; this module owns the clock and the counters behind these scenes.
import { between } from './planner.mjs'
import { fixedLine } from './phases.mjs'
import { TEMPO } from './tempo.mjs'

/**
 * @param options.engine the animation engine; its scene events are fed to onSceneEvent
 * @param options.random seeded PRNG (tests)
 * @param options.locale `() => 'ru' | 'en' | 'zh-CN'`
 * @param options.isWorking `() => boolean` the snapshot shows work in progress
 * @param options.isWaiting `() => boolean` a request waits for the user
 * @param options.isProblem `(now) => boolean` a terminal problem is on screen
 * @param options.isBusy `(now) => boolean` any work, request or problem: the wallet waits for quiet
 * @param options.toolErrorActive `() => boolean` a tool-error reaction is queued or playing
 */
export function createEverydayScenes({
  engine, random, locale, isWorking, isWaiting, isProblem, isBusy, toolErrorActive,
}) {
  // Work stack: accumulated busy time excluding waiting, with a random 3–5 minute threshold
  // per period and a long cooldown after every snack.
  let workAccumMs = 0
  let busySince = null
  let quietSince = null
  let mealThresholdMs = TEMPO.mealWorkMaxMs
  let mealUntil = 0
  let mealPending = false
  let mealResumeElapsed = 0
  let mealVariantId = null
  let mealShownMs = 0
  let mealLastRenderAt = null
  let mealCooldownUntil = 0
  let mealLine = null
  // Wallet: scheduled once when a review burst starts, then a long cooldown.
  let walletAt = 0
  let walletUntil = 0
  let walletCooldownUntil = 0
  let walletLine = null

  /** Add the time since the last drawn meal frame; a long gap was not shown. */
  function countMealShown(at) {
    if (mealLastRenderAt !== null) {
      const elapsed = at - mealLastRenderAt
      if (elapsed >= 0 && elapsed <= TEMPO.mealRenderGapMs) mealShownMs += elapsed
    }
    mealLastRenderAt = at
  }

  function startMeal(now, resume = false) {
    if (isWaiting() || isProblem(now) || toolErrorActive() || (mealPending && !resume) || mealUntil > 0) return false
    mealPending = true
    mealLine = random() < TEMPO.mealLineChance ? fixedLine(locale(), 'meal') : null
    const options = { elapsedMs: mealResumeElapsed, now }
    if (resume) options.variantId = mealVariantId
    if (!engine.playScene('meal', TEMPO.mealMs, options)) {
      mealPending = false
      return false
    }
    return true
  }

  function startWallet(now) {
    if (!engine.playScene('wallet', TEMPO.walletMs, { now })) return false
    walletAt = 0
    walletCooldownUntil = now + TEMPO.walletCooldownMs
    walletLine = random() < TEMPO.walletLineChance ? fixedLine(locale(), 'wallet') : null
    return true
  }

  function mealIsQueued() {
    const act = engine.activeAct()
    return act?.sceneId === 'meal' || act?.pendingScene?.sceneId === 'meal'
  }

  /** Scene events of the snack and the wallet; the behaviour forwards every event here. */
  function onSceneEvent(event) {
    if (event.type === 'render') {
      if (event.sceneId === 'meal') countMealShown(event.at)
      return
    }
    if (event.type === 'start') {
      if (event.sceneId === 'meal') {
        mealPending = false
        mealUntil = event.until
        mealResumeElapsed = 0
        mealVariantId = event.variantId ?? null
        mealLastRenderAt = null
        if (busySince !== null) {
          workAccumMs += Math.max(0, event.startedAt - busySince)
          busySince = null
        }
      } else if (event.sceneId === 'wallet') {
        walletUntil = event.startedAt + TEMPO.walletMs
      }
    } else if (event.type === 'complete' || event.type === 'interrupt') {
      if (event.sceneId === 'meal') {
        countMealShown(event.at)
        const shown = mealShownMs
        mealUntil = 0
        mealLastRenderAt = null
        if (shown < TEMPO.mealMinShownMs) {
          mealPending = true
          mealResumeElapsed = shown
        } else {
          mealPending = false
          mealResumeElapsed = 0
          mealVariantId = null
          mealShownMs = 0
          mealCooldownUntil = event.at + between(TEMPO.mealCooldownMinMs, TEMPO.mealCooldownMaxMs, random)
          workAccumMs = 0
          mealThresholdMs = between(TEMPO.mealWorkMinMs, TEMPO.mealWorkMaxMs, random)
        }
        if (isWorking() && !isWaiting() && !isProblem(event.at)) {
          busySince = event.at
          quietSince = null
        } else {
          busySince = null
        }
      } else if (event.sceneId === 'wallet') {
        walletUntil = 0
      }
    }
  }

  /**
   * One step of the pacing, once per frame: the work stack, a resumed snack, the wallet check
   * and a new snack. Completion comes from the scene instance, never from a guess about how
   * long the art takes.
   */
  function tick(now, { waiting, problem, sleeping, features }) {
    const working = isWorking()
    if (mealUntil > 0) {
      busySince = null
    } else if (working && !waiting && !problem && !sleeping) {
      if (busySince === null) busySince = now
      quietSince = null
    } else if (waiting) {
      if (busySince !== null) {
        workAccumMs += Math.max(0, now - busySince)
        busySince = null
      }
      // User wait is excluded from work and does not erase the accumulated stack.
      quietSince = null
    } else {
      if (busySince !== null) {
        workAccumMs += Math.max(0, now - busySince)
        busySince = null
      }
      if (quietSince === null) quietSince = now
      if (now - quietSince > TEMPO.workGapMs) workAccumMs = 0
    }
    const workMs = workAccumMs + (busySince === null ? 0 : Math.max(0, now - busySince))

    // A requested meal may be queued behind the work scene's exit. Re-submitting it as a
    // resume would replace the original weighted variant with the still-null resume variant.
    if (mealPending && !mealIsQueued() && !waiting && !problem && features.meal
      && now >= mealCooldownUntil) startMeal(now, true)

    if (walletAt > 0) {
      if (isBusy(now) || waiting || problem) {
        walletAt = 0
      } else if (now >= walletAt && mealUntil === 0) {
        if (features.wallet && now >= walletCooldownUntil) startWallet(now)
        else walletAt = 0
      }
    }

    if (mealUntil === 0 && !mealPending && features.meal && !sleeping
      && !waiting && !problem && workMs >= mealThresholdMs && now >= mealCooldownUntil) {
      startMeal(now)
    }
  }

  return {
    onSceneEvent,
    tick,
    /** Start a snack from the idle pool; the caller has already rolled for it. */
    startMeal,
    mealCooling: (now) => now < mealCooldownUntil,
    scheduleWallet(at) {
      walletAt = at
    },
    cancelWallet() {
      walletAt = 0
      walletUntil = 0
      walletLine = null
    },
    start() {
      mealThresholdMs = between(TEMPO.mealWorkMinMs, TEMPO.mealWorkMaxMs, random)
    },
    /** A snack or the wallet is playing or about to; idle antics and wandering wait. */
    busy: () => mealPending || mealUntil > 0 || walletUntil > 0,
    /** Either scene is on screen, queued, or about to be: the scene owns the pose. */
    active() {
      const act = engine.activeAct()
      return mealPending || mealUntil > 0 || walletUntil > 0
        || act?.sceneId === 'meal' || act?.sceneId === 'wallet'
        || act?.pendingScene?.sceneId === 'meal' || act?.pendingScene?.sceneId === 'wallet'
    },
    mealShown: (now) => mealUntil > now || mealPending,
    walletShown: (now) => walletUntil > now,
    mealLine: () => mealLine,
    walletLine: () => walletLine,
    workMs: (now) => workAccumMs + (busySince === null ? 0 : now - busySince),
    debug: () => ({
      mealThresholdMs,
      mealUntil,
      mealPending,
      mealResumeElapsed,
      mealShownMs,
      mealCooldownUntil,
      walletAt,
      walletUntil,
      walletCooldownUntil,
    }),
  }
}
