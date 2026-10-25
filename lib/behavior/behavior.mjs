// The shared behaviour controller: one decision for pose, bubble and click.
//
// Both surfaces (the in-page overlay and the desktop page) own only their DOM and
// their window bridge; everything about WHAT the pet does lives here, so a fix lands
// in one place and both surfaces stay identical.
//
// Priority, highest first (plan §4):
//   1. an open request — waiting pose, fixed "Жду тебя", click opens the request
//   2. a terminal problem — worried pose, its own phrase, click opens the chat
//   3. direct control (dragging, menu) — handled by the surface, never answers requests
//   4. completion / quiet notes
//   5. the current work phase — a scene (enter/loop/exit) or a legacy act
//   6. hover reactions in a free state
//   7. idle antics, sleep, neutral pose
//
// The snack and the wallet are timed in lib/behavior/everyday.mjs; the pacing numbers live in
// lib/behavior/tempo.mjs. Nothing here touches timers or the network: the surface calls update()
// with a clock.

import { availableActs, createActPlanner, pickWeighted } from './planner.mjs'
import { ALERT_POOLS, createBubbles } from './bubble.mjs'
import { normaliseSnapshot } from '../protocol/contract.mjs'
import { WORK_SCENES, PHASE_SCENES, phaseKey } from './phases.mjs'
import { createEverydayScenes } from './everyday.mjs'
import { TEMPO } from './tempo.mjs'

export { TEMPO } from './tempo.mjs'

/**
 * @param options.index indexed manifest
 * @param options.engine the animation engine
 * @param options.random seeded PRNG (tests)
 * @param options.clock monotonic clock (tests)
 */
export function createBehavior({ index, engine, random = Math.random, clock = () => Date.now() }) {
  // Meals and the wallet move to meaning-driven scenes (M4); as random filler they
  // would fire in a free moment and contradict the plan. The art stays reachable.
  const idleActs = (index.acts?.idle ?? []).filter(
    (act) => act.anim !== 'eatRice' && act.anim !== 'sushiTray' && act.anim !== 'tokenWallet',
  )

  const planner = createActPlanner({
    random,
    idleMinMs: TEMPO.idleMinMs,
    idleMaxMs: TEMPO.idleMaxMs,
    firstIdleMinMs: TEMPO.firstIdleMinMs,
    firstIdleMaxMs: TEMPO.firstIdleMaxMs,
    workingMinMs: TEMPO.workingMinMs,
    workingMaxMs: TEMPO.workingMaxMs,
    hoverCooldownMs: TEMPO.hoverCooldownMs,
  })

  let snapshot = normaliseSnapshot(null)
  let locale = 'ru'
  let started = false
  let lastActiveAt = clock()
  let currentPhase = null
  let toolHoldUntil = 0
  let hoverUntil = 0
  let initialSnapshotSeen = false
  let lastToolErrorId = null
  let lastToolErrorAt = -Infinity
  let deferredToolError = false
  const features = { randomActs: true, reactToHover: true, meal: true, wallet: true }

  const isWaiting = () => snapshot.waitingForUser
  const isProblem = (now = clock()) => (snapshot.mood === 'failed' || snapshot.mood === 'limited') && snapshot.until > now
  const isWorking = () => snapshot.activeSessions > 0 || (snapshot.tool !== null && snapshot.tool.open) || snapshot.phase !== null
  const isBusy = (now = clock()) => isWaiting() || isProblem(now) || isWorking()

  function actualScene() {
    const act = engine.activeAct()
    return act?.kind === 'scene' ? act.sceneId : null
  }

  /** The tool-error reaction is queued or playing; the engine owns that state. */
  function toolErrorSceneActive() {
    const act = engine.activeAct()
    return act?.sceneId === 'toolError' || act?.pendingScene?.sceneId === 'toolError'
  }

  const everyday = createEverydayScenes({
    engine,
    random,
    locale: () => locale,
    isWorking,
    isWaiting,
    isProblem,
    isBusy,
    toolErrorActive: toolErrorSceneActive,
  })

  const bubbles = createBubbles({
    random,
    tempo: TEMPO,
    locale: () => locale,
    snapshot: () => snapshot,
    isWaiting,
    isProblem,
    actualScene,
    everydaySceneActive: everyday.active,
    hoverUntil: () => hoverUntil,
    mealShown: everyday.mealShown,
    walletShown: everyday.walletShown,
    mealLine: everyday.mealLine,
    walletLine: everyday.walletLine,
  })

  engine.setSceneListener((event) => {
    everyday.onSceneEvent(event)
    if (event.type === 'start' && WORK_SCENES.has(event.sceneId)) {
      toolHoldUntil = event.startedAt + TEMPO.toolHoldMinMs
    }
  })

  function actPool(group) {
    const list = group === 'idle' ? idleActs : (index.acts?.[group] ?? [])
    return availableActs(list, (animId) => engine.isAvailable(animId))
  }

  function playLegacy(animId, ms, now = clock()) {
    if (typeof animId !== 'string' || animId === '') return false
    return engine.playAct(animId, ms, { now })
  }

  function switchToPhase(key, now) {
    const coordinating = snapshot.team.coordinating
    currentPhase = coordinating ? 'team' : key
    if (everyday.active() || toolErrorSceneActive()) return
    const act = engine.activeAct()
    const mapping = coordinating
      ? { scene: 'team', anim: 'useTool' }
      : (key === null ? null : PHASE_SCENES[key])
    if (mapping === undefined) return
    const activeWorkScene = act?.kind === 'scene' && WORK_SCENES.has(act.sceneId)
    if (activeWorkScene && !act.ending
      && now < Math.max(toolHoldUntil, act.startedAt + TEMPO.toolHoldMinMs)) return
    if (mapping === null) {
      if (activeWorkScene) engine.endScene(now)
      return
    }
    if (act?.sceneId === mapping.scene && !act.ending && act.pendingScene === null) return
    if (engine.playScene(mapping.scene, Infinity, { now })) return
    playLegacy(mapping.anim, TEMPO.toolHoldMs, now)
    toolHoldUntil = now + TEMPO.toolHoldMinMs
  }

  function queueToolError(now) {
    if (!deferredToolError || now - lastToolErrorAt < TEMPO.toolErrorCooldownMs) return false
    if (isWaiting() || isProblem(now) || everyday.active() || toolErrorSceneActive()) return false
    if (!engine.playScene('toolError', TEMPO.toolErrorMs, { now })) return false
    deferredToolError = false
    lastToolErrorAt = now
    return true
  }

  return {
    features,
    TEMPO,

    start(now = clock()) {
      if (started) return
      started = true
      lastActiveAt = now
      everyday.start()
      planner.start(now)
    },

    setLocale(value) {
      const next = typeof value === 'string' && value !== '' ? value : 'ru'
      if (next === locale) return
      locale = next
      bubbles.reset()
    },

    getSnapshot() {
      return snapshot
    },

    /** Feed a new snapshot. Revision-only and duplicate-phase updates preserve pacing. */
    applySnapshot(value, changed, now = clock()) {
      const next = normaliseSnapshot(value)
      const previous = snapshot
      // Capture before the engine drops the act: an interrupted reaction is still owed.
      const interruptedToolError = toolErrorSceneActive()
      snapshot = next
      engine.setSnapshot(next, now)

      if (!initialSnapshotSeen) {
        initialSnapshotSeen = true
        lastToolErrorId = next.toolError?.id ?? null
      } else if (next.toolError !== null && next.toolError.id !== lastToolErrorId) {
        lastToolErrorId = next.toolError.id
        deferredToolError = true
      }

      if (changed) {
        lastActiveAt = now
        planner.markActivity(now)
      }
      if (isWaiting() || isProblem(now) || (next.mood === 'review' && next.until > now)) {
        bubbles.reset()
        hoverUntil = 0
      }

      if (isWaiting() || isProblem(now)) {
        if (interruptedToolError) deferredToolError = true
        engine.clearAct(now)
        everyday.cancelWallet()
      } else {
        if (next.mood === 'review' && previous.mood !== 'review') {
          everyday.scheduleWallet((next.until > now ? next.until : now) + TEMPO.reviewTailMs)
        }
        switchToPhase(phaseKey(next), now)
      }
      return true
    },

    /**
     * Advance the player before deciding, then pick at most one act for a quiet moment.
     */
    update(now = clock(), options = {}) {
      engine.resolve(now, { render: false })
      const waiting = isWaiting()
      const problem = isProblem(now)
      everyday.tick(now, { waiting, problem, sleeping: engine.isSleeping(), features })

      const busy = isBusy(now) || options.busy === true || everyday.busy()
      if (busy) {
        lastActiveAt = now
        if (engine.isSleeping()) engine.setSleeping(false, now)
      } else if (!engine.isSleeping() && now - lastActiveAt >= TEMPO.sleepAfterMs) {
        engine.setSleeping(true, now)
        bubbles.reset()
      }

      if (!waiting && !problem && !everyday.active() && !toolErrorSceneActive()) {
        switchToPhase(phaseKey(snapshot), now)
      }
      queueToolError(now)

      if (engine.isSleeping() || waiting || problem || everyday.busy()) return
      if (snapshot.activeSessions > 0) {
        if (snapshot.phase === null && (snapshot.tool === null || !snapshot.tool.open)
          && features.randomActs && planner.workingDue(now)) {
          const act = pickWeighted(actPool('working'), random)
          if (act !== null) engine.playAct(act.anim, act.ms, { now })
        }
        return
      }
      if (features.randomActs && planner.idleDue(now)) {
        if (features.meal && !everyday.mealCooling(now) && random() < 0.25) everyday.startMeal(now)
        else {
          const act = pickWeighted(actPool('idle'), random)
          if (act !== null) engine.playAct(act.anim, act.ms, { now })
        }
      }
    },

    /**
     * The pointer entered the pet. Answers only in a free state; during a request a
     * light gaze is allowed but the pose, bubble and click target stay put.
     * @returns whether a hover reaction was played
     */
    hover(now = clock()) {
      if (!features.reactToHover || isWaiting() || isProblem(now) || !planner.hoverDue(now)) return false
      const sceneId = actualScene()
      if (sceneId !== null) {
        const micros = (index.scenes?.[sceneId]?.micros ?? []).filter((animId) => engine.isAvailable(animId))
        if (micros.length === 0) return false
        const animId = micros[Math.floor(random() * micros.length)]
        const played = engine.playMicro(animId, 700, now)
        if (played) hoverUntil = now + TEMPO.hoverLineMs
        return played
      }
      if (everyday.active()) return false
      return this.react(now)
    },

    /**
     * A short, deliberate reaction (a clean click in a free state). Unlike hover it
     * ignores the cursor cooldown, because the user asked for it.
     * @returns whether a reaction was played
     */
    react(now = clock()) {
      if (isWaiting() || isProblem(now) || isBusy(now) || everyday.active()) return false
      if (engine.isSleeping()) {
        engine.setSleeping(false, now)
        lastActiveAt = now
        planner.markActivity(now)
        bubbles.reset()
        return true
      }
      if (actualScene() !== null) return false
      const act = pickWeighted(actPool('hover'), random)
      if (act === null) return false
      engine.playAct(act.anim, act.ms, { now })
      hoverUntil = now + TEMPO.hoverLineMs
      return true
    },

    /**
     * Everything a surface needs to draw the bubble: text, colour treatment and which
     * pool it came from (the wallet pool may add token details as a tooltip).
     */
    bubbleInfo(now = clock()) {
      const decision = bubbles.decide(now)
      if (decision === null) return null
      return {
        text: decision.text,
        tone: ALERT_POOLS.has(decision.pool) ? 'alert' : 'normal',
        pool: decision.pool,
      }
    },

    /**
     * The bubble text right now, or null when the bubble should hide.
     * Requests, problems and completion phrases are fixed and never rotated.
     */
    bubble(now = clock()) {
      const info = this.bubbleInfo(now)
      return info === null ? null : info.text
    },

    /**
     * The colour treatment of the current bubble: 'alert' is the amber of Harness's own
     * approval notice (waiting, problems, file edits, commands), 'normal' everything else.
     */
    bubbleTone(now = clock()) {
      const info = this.bubbleInfo(now)
      return info === null ? 'normal' : info.tone
    },

    /**
     * What a plain left click should do, according to the same priority as the pose.
     * `navigate` carries an opaque target ref; everything else is a free-state action.
     */
    clickAction() {
      if (isWaiting() && snapshot.attention?.targetRef) {
        return { kind: 'navigate', targetRef: snapshot.attention.targetRef, requestKind: snapshot.attention.kind }
      }
      if (snapshot.navigation?.targetRef) {
        return { kind: 'navigate', targetRef: snapshot.navigation.targetRef, requestKind: snapshot.navigation.kind }
      }
      // No menu of our own any more: settings live in Harness, so a free click earns a
      // short reaction and nothing else (plan §6.2).
      return { kind: 'react' }
    },

    isWaiting,
    isProblem,
    isAsleep: () => engine.isSleeping(),
    /**
     * True when nothing is happening at all — no request, no problem, no work, no sleep.
     * Wandering must be gated on this meaning, never on the drawn animation id: while
     * she walks, the pose is `runLeft`/`runRight`, and gating on that made the loop stop
     * the walk on the very frame it started (one visible hop, then a pause).
     */
    isQuiet(now = clock()) {
      return !isWaiting() && !isProblem(now) && snapshot.activeSessions === 0
        && (snapshot.tool === null || !snapshot.tool.open)
        && snapshot.phase === null && !engine.isSleeping() && !everyday.active()
        && !toolErrorSceneActive()
    },
    debug() {
      return {
        phase: currentPhase,
        scene: actualScene(),
        sleeping: engine.isSleeping(),
        linePool: bubbles.pool(),
        lastActiveAt,
        workMs: everyday.workMs(clock()),
        deferredToolError,
        toolErrorSceneActive: toolErrorSceneActive(),
        ...everyday.debug(),
      }
    },
  }
}
