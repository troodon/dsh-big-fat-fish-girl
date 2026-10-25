// The animation engine is the sole owner of playback instances and frame time.
// It takes snapshots and timestamps, but owns no DOM, timer, or network resource.
// Both the in-page and desktop surfaces use this same player.

import { animationDuration, cellFor, frameIndex, gazeCell } from './manifest.mjs'
import { normaliseSnapshot } from '../protocol/contract.mjs'
import { reportOnce } from '../diagnostics.mjs'

const TRANSIENT_STATES = new Set(['welcome', 'review', 'failed', 'limited'])

export function createEngine({
  index, random = Math.random, clock = () => Date.now(),
  // A failing scene listener is a bug in its owner. It is reported, and the frame still draws.
  onError = (error) => reportOnce('scene listener failed', error),
}) {
  const animations = index.animations
  const sheets = index.sheets
  const scenes = index.scenes ?? {}

  let snapshot = normaliseSnapshot(null)
  let act = null
  let pendingScene = null
  let micro = null
  let gaze = null
  let gazeProfile = null
  let moving = null
  let sleeping = false
  let reducedMotion = false
  let paused = false
  let pauseAt = 0
  let sceneListener = () => {}

  let currentAnimId = null
  let animStartedAt = 0
  const unavailable = new Set()

  const isAvailable = (animId) => animations.has(animId) && !unavailable.has(animId)
  const pick = (animId) => (typeof animId === 'string' && isAvailable(animId) ? animId : null)
  const isWaiting = () => snapshot.waitingForUser

  function chooseSceneVariant(scene) {
    const variants = (scene.variants ?? []).filter((variant) =>
      variant !== null && typeof variant.anim === 'string'
      && Number.isFinite(variant.weight) && variant.weight > 0 && isAvailable(variant.anim),
    )
    if (variants.length === 0) return null
    let roll = random() * variants.reduce((sum, variant) => sum + variant.weight, 0)
    for (const variant of variants) {
      if (roll < variant.weight) return variant.anim
      roll -= variant.weight
    }
    return variants[variants.length - 1].anim
  }

  function emit(type, details = {}, at = clock()) {
    try { sceneListener({ type, at, ...details }) } catch (error) { onError(error) }
  }

  function stateId(name) {
    const state = index.states[name]
    if (state === undefined || typeof state.anim !== 'string') return null
    if (isAvailable(state.anim)) return state.anim
    if (typeof state.fallback === 'string' && isAvailable(state.fallback)) return state.fallback
    return null
  }

  function stateAnim(now) {
    if (isWaiting()) return stateId('waiting') ?? 'idle'
    if ((snapshot.mood === 'failed' || snapshot.mood === 'limited') && snapshot.until > now) {
      return stateId(snapshot.mood) ?? 'idle'
    }
    if (moving === 'left') return stateId('dragLeft') ?? 'idle'
    if (moving === 'right') return stateId('dragRight') ?? 'idle'
    if (TRANSIENT_STATES.has(snapshot.mood) && snapshot.until > now) return stateId(snapshot.mood) ?? 'idle'
    if (snapshot.activeSessions > 0 || snapshot.mood === 'running') return stateId('running') ?? 'idle'
    // Cursor motion is not a wake-up signal. Sleep remains a stable, higher-priority pose.
    if (sleeping) return stateId('sleeping') ?? 'idle'
    if (gaze !== null) {
      const gazeId = stateId('gaze')
      if (gazeId !== null) return gazeId
    }
    return stateId('idle') ?? 'idle'
  }

  function sceneParts(sceneId, variantAnimId) {
    const scene = scenes[sceneId]
    if (scene === undefined) return null
    const selectedEnter = variantAnimId === undefined
      ? (scene.variants?.find((variant) => pick(variant?.anim) !== null)?.anim ?? scene.enter)
      : (variantAnimId ?? scene.enter)
    const parts = Object.fromEntries(['enter', 'loop', 'hold', 'exit', 'static', 'fallback']
      .map((key) => [key, pick(key === 'enter' ? selectedEnter : scene[key])]))
    if (![parts.enter, parts.loop, parts.hold, parts.exit, parts.fallback].some((value) => value !== null)) return null
    return { scene, parts }
  }

  function startScene(sceneId, duration, options = {}, startedAt = clock()) {
    const scene = scenes[sceneId]
    const declaredVariants = scene?.variants ?? []
    const variantAnimId = options.variantId === null
      ? null
      : (typeof options.variantId === 'string' && declaredVariants.some((variant) => variant?.anim === options.variantId)
        ? options.variantId
        : chooseSceneVariant(scene))
    const resolved = sceneParts(sceneId, variantAnimId)
    if (resolved === null) return false
    const finite = Number.isFinite(duration)
    const elapsed = Number.isFinite(options.elapsedMs) ? Math.max(0, options.elapsedMs) : 0
    const instanceId = `${sceneId}:${startedAt}`
    act = {
      kind: 'scene',
      sceneId,
      startedAt,
      elapsedOffset: elapsed,
      until: finite ? startedAt + Math.max(0, duration - elapsed) : Infinity,
      ending: false,
      forced: options.force === true,
      instanceId,
      variantAnimId,
      lastSegment: null,
    }
    emit('start', { sceneId, startedAt, elapsedMs: elapsed, until: act.until, instanceId, variantId: variantAnimId }, startedAt)
    return true
  }

  function activatePending(at) {
    const pending = pendingScene
    pendingScene = null
    if (pending !== null) startScene(pending.sceneId, pending.duration, pending.options, at)
  }

  function finishAct(now) {
    if (act === null || act.until > now) return
    const completed = act
    act = null
    micro = null
    if (completed.kind === 'scene') emit('complete', { sceneId: completed.sceneId, instanceId: completed.instanceId }, completed.until)
    if (completed.kind === 'scene' && completed.ending) activatePending(completed.until)
  }

  function scenePlayback(now) {
    if (act === null || act.kind !== 'scene') return null
    finishAct(now)
    if (act === null || act.kind !== 'scene') return null
    const resolved = sceneParts(act.sceneId, act.variantAnimId)
    if (resolved === null) return null
    const { scene, parts } = resolved
    let animationId = null
    let elapsed = 0
    let segment = 'hold'

    if (act.ending) {
      animationId = parts.exit
      elapsed = Math.max(0, now - act.exitStartedAt)
      segment = 'exit'
    } else {
      const sinceStart = act.elapsedOffset + Math.max(0, now - act.startedAt)
      const enterDuration = parts.enter === null ? 0 : animationDuration(animations.get(parts.enter))
      const exitDuration = parts.exit === null ? 0 : animationDuration(animations.get(parts.exit))
      if (parts.exit !== null && Number.isFinite(act.until) && act.until - now <= exitDuration) {
        animationId = parts.exit
        elapsed = Math.max(0, exitDuration - (act.until - now))
        segment = 'exit'
      } else if (parts.enter !== null && sinceStart < enterDuration) {
        animationId = parts.enter
        elapsed = sinceStart
        segment = 'enter'
      } else if (parts.loop !== null) {
        animationId = parts.loop
        elapsed = Math.max(0, sinceStart - enterDuration)
        segment = 'loop'
      } else if (parts.hold !== null) {
        animationId = parts.hold
        elapsed = animationDuration(animations.get(parts.hold))
        segment = 'hold'
      } else if (parts.enter !== null) {
        animationId = parts.enter
        elapsed = enterDuration
        segment = 'hold'
      } else {
        animationId = parts.exit ?? parts.fallback
        elapsed = sinceStart
      }
    }

    if (reducedMotion && parts.static !== null) {
      animationId = parts.static
      elapsed = 0
      segment = 'static'
    }
    if (animationId === null) animationId = parts.fallback
    if (animationId === null) return null
    if (act.lastSegment !== segment) {
      act.lastSegment = segment
      emit('segment', { sceneId: act.sceneId, segment, animationId }, now)
    }
    return { animationId, elapsed, sceneId: act.sceneId, segment }
  }

  function statePlayback(now) {
    const animationId = stateAnim(now)
    return { animationId, elapsed: currentAnimId === animationId ? Math.max(0, now - animStartedAt) : 0 }
  }

  function resolvedPlayback(now) {
    finishAct(now)
    if (isWaiting()) {
      clearAct(now)
      return statePlayback(now)
    }
    if (moving !== null) return statePlayback(now)
    if (micro !== null) {
      if (micro.until <= now) micro = null
      else return { animationId: micro.animId, elapsed: now - micro.startedAt, sceneId: act.sceneId, segment: 'micro' }
    }
    if (act?.kind === 'scene') {
      const playback = scenePlayback(now)
      if (playback !== null) return playback
    } else if (act?.kind === 'anim') {
      if (act.until > now && isAvailable(act.animId)) return { animationId: act.animId, elapsed: now - act.startedAt }
      act = null
    }
    return statePlayback(now)
  }

  function clearAct(at = clock()) {
    if (act?.kind === 'scene') emit('interrupt', { sceneId: act.sceneId, instanceId: act.instanceId }, at)
    act = null
    pendingScene = null
    micro = null
  }

  function beginExit(at = clock()) {
    if (act === null || act.kind !== 'scene' || act.ending) return false
    const exit = pick(scenes[act.sceneId]?.exit)
    if (exit === null) {
      const completed = act
      act = null
      emit('complete', { sceneId: completed.sceneId, instanceId: completed.instanceId }, at)
      activatePending(at)
      return false
    }
    act.ending = true
    act.exitStartedAt = at
    act.until = act.exitStartedAt + animationDuration(animations.get(exit))
    act.lastSegment = null
    return true
  }

  return {
    setSnapshot(value, at = clock()) {
      snapshot = normaliseSnapshot(value)
      const realActivity = isWaiting() || snapshot.mood !== 'idle' || snapshot.activeSessions > 0
      if (sleeping && realActivity) {
        sleeping = false
        if (act?.kind === 'scene' && act.sceneId === 'sleep') clearAct(at)
      }
      if (isWaiting() && act !== null) clearAct(at)
      return snapshot
    },
    getSnapshot() {
      return { ...snapshot, team: { ...snapshot.team }, toolError: snapshot.toolError === null ? null : { ...snapshot.toolError } }
    },
    setSceneListener(listener) {
      sceneListener = typeof listener === 'function' ? listener : () => {}
    },
    playAct(animId, ms, options = {}) {
      if (!isAvailable(animId) || isWaiting()) return false
      const at = Number.isFinite(options.now) ? options.now : clock()
      if (act?.kind === 'scene' && !options.force) return false
      if (act?.kind === 'scene') clearAct(at)
      act = {
        kind: 'anim', animId,
        startedAt: at,
        until: at + Math.max(0, ms),
        forced: options.force === true,
      }
      return true
    },
    /** Start or request the latest scene; an active exit is never overwritten. */
    playScene(sceneId, ms = Infinity, options = {}) {
      if (scenes[sceneId] === undefined || isWaiting()) return false
      const duration = Number.isFinite(ms) ? Math.max(0, ms) : Infinity
      if (sceneParts(sceneId) === null) return false
      const at = Number.isFinite(options.now) ? options.now : clock()
      if (act?.kind === 'scene' && act.sceneId === sceneId && !act.ending) {
        act.until = duration === Infinity ? Infinity : act.startedAt + Math.max(0, duration - act.elapsedOffset)
        return true
      }
      if (act?.kind === 'scene' && act.ending) {
        pendingScene = { sceneId, duration, options: { ...options } }
        return true
      }
      if (act?.kind === 'scene') {
        pendingScene = { sceneId, duration, options: { ...options } }
        beginExit(at)
        return true
      }
      if (act !== null) {
        emit('interrupt', { kind: act.kind, animId: act.animId }, at)
        act = null
      }
      micro = null
      return startScene(sceneId, duration, options, at)
    },
    /** Temporary compatible reaction: the underlying scene clock keeps advancing. */
    playMicro(animId, ms, at = clock()) {
      if (!isAvailable(animId) || isWaiting() || act?.kind !== 'scene') return false
      micro = { animId, startedAt: at, until: at + Math.max(0, ms) }
      return true
    },
    endScene(at = clock()) {
      if (act === null || act.kind !== 'scene') return false
      pendingScene = null
      return beginExit(at)
    },
    clearAct,
    activeAct() {
      if (act === null) return null
      return { ...act, pendingScene: pendingScene === null ? null : { ...pendingScene } }
    },
    setGaze(direction, profile = null) {
      gaze = Number.isInteger(direction) ? direction : null
      gazeProfile = gaze === null ? null : profile
    },
    setMoving(direction) {
      moving = direction === 'left' || direction === 'right' ? direction : null
    },
    setSleeping(value, at = clock()) {
      const next = value === true
      if (next === sleeping) return sleeping
      sleeping = next
      if (sleeping && scenes.sleep !== undefined && !isWaiting()) this.playScene('sleep', Infinity, { force: true, now: at })
      else if (!sleeping && act?.kind === 'scene' && act.sceneId === 'sleep') beginExit(at)
      return sleeping
    },
    isSleeping() {
      return sleeping
    },
    setReducedMotion(value) {
      reducedMotion = value === true
    },
    setPaused(value) {
      const next = value === true
      if (next === paused) return
      if (next) {
        pauseAt = clock()
        paused = true
        return
      }
      const delta = Math.max(0, clock() - pauseAt)
      if (act !== null) {
        act.startedAt += delta
        if (Number.isFinite(act.until)) act.until += delta
        if (Number.isFinite(act.exitStartedAt)) act.exitStartedAt += delta
      }
      if (micro !== null) {
        micro.startedAt += delta
        micro.until += delta
      }
      paused = false
    },
    setUnavailable(animId, value = true) {
      if (value) unavailable.add(animId)
      else unavailable.delete(animId)
    },
    isAvailable,
    resolve(now = clock(), options = {}) {
      const playback = paused
        ? (act?.kind === 'scene' ? scenePlayback(pauseAt) : null)
        : resolvedPlayback(now)
      if (playback === null) return null
      const animId = playback.animationId
      const animation = animations.get(animId)
      if (animation === undefined) return null
      if (animId !== currentAnimId) {
        currentAnimId = animId
        animStartedAt = now - playback.elapsed
      }
      const sheet = sheets[animation.sheet]
      const state = Object.entries(index.states).find(([, value]) => value.anim === animId)
      const gazeState = state !== undefined && state[1].gaze === true
      const gazeAnimation = gazeProfile?.gazeRows
        ? { ...animation, gazeRows: gazeProfile.gazeRows }
        : animation
      const cell = gazeState && gaze !== null
        ? (gazeCell(gaze, gazeAnimation, sheet, { mirror: gazeProfile?.mirrorLeft === true }) ?? cellFor(0, animation, sheet))
        : cellFor(frameIndex(animation, playback.elapsed, reducedMotion), animation, sheet)
      const result = {
        animId,
        sheet: animation.sheet,
        row: cell.row,
        column: cell.column,
        looping: animation.loop,
        reduced: reducedMotion,
        paused,
        sceneId: playback.sceneId ?? null,
        segment: playback.segment ?? null,
      }
      if (cell.flipX === true) result.flipX = true
      if (options.render !== false && result.sceneId !== null) {
        emit('render', { sceneId: result.sceneId, segment: result.segment, animationId: animId }, now)
      }
      return result
    },
    debug(now = clock()) {
      return {
        animId: currentAnimId ?? stateAnim(now),
        act: act === null ? null : { ...act, pendingScene: pendingScene === null ? null : { ...pendingScene } },
        pendingScene: pendingScene === null ? null : { ...pendingScene },
        micro: micro === null ? null : { ...micro },
        gaze,
        moving,
        sleeping,
        paused,
        reducedMotion,
        unavailable: [...unavailable],
        snapshot: { ...snapshot },
      }
    },
  }
}
