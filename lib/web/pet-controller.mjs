// The controller both browser surfaces drive: the in-page overlay (lib/web/client-entry.mjs)
// and the desktop page (desktop/pet-desktop.mjs). It owns what the two share: the animation
// core, the sheets, the frame loop, the bubble, the settings it applies and the strolls.
// What differs between the surfaces comes in through `hooks`: where the pet may walk, how a
// stroll moves it, what holds the pet still, and what the surrounding shell needs to hear.
//
// Order matters: create, applyPrefs(...), place the element, then start(). Nothing runs
// before start() except the first applyPrefs.
import { DEFAULT_MANIFEST, indexManifest } from '../animation/manifest.mjs'
import { createEngine } from '../animation/engine.mjs'
import { createBehavior } from '../behavior/behavior.mjs'
import { createRandom } from '../behavior/planner.mjs'
import { createWanderer } from '../behavior/wander.mjs'
import { normalisePrefs, samePrefs } from '../settings/prefs.mjs'
import { bubbleBottomPx } from '../rendering/bubble-layout.mjs'
import { canvasSideForSize, centeredCanvasOffset } from '../rendering/pet-geometry.mjs'
import { skinSheetUrl } from '../animation/sheets.mjs'
import {
  applyRendererPrefs, bubbleContent, createCanvasRenderer, createFrameLoop, createSheetLoader, frameIntervalMs,
} from './surface.mjs'

/** The custom properties that size the pet; both surfaces read the same three. */
export function applySizeVars(host, size) {
  host.style.setProperty('--bffg-size', `${size}px`)
  host.style.setProperty('--bffg-canvas-side', `${canvasSideForSize(size)}px`)
  host.style.setProperty('--bffg-canvas-left', `${centeredCanvasOffset(size)}px`)
}

/**
 * @param options.host element that carries the size variables, the data attributes and `hidden`
 * @param options.canvas the canvas the frames are drawn into
 * @param options.bubble the speech bubble element
 * @param options.context 2D context of the canvas, or null where there is none
 * @param options.dpr device pixel ratio
 * @param options.seed seed of the randomness
 * @param options.speedPxPerSec walking speed
 * @param options.reducedQuery MediaQueryList for prefers-reduced-motion, or null
 * @param options.shouldRun `() => boolean`; false pauses the frame loop (hidden tab)
 * @param options.hooks the surface's behaviour, all optional:
 *   walkGate() — true while the surface holds the pet still (pointer, drag); strolls wait
 *   busy() — true while the user is interacting; keeps the behaviour awake
 *   walkBounds() — `{ min, max }` where a stroll may go, or null to stand still
 *   moveWalk(move) — move the element or the window by one stroll step
 *   onWalkEnd() — a stroll just finished
 *   onPrefs(prefs) — the settings were applied
 *   onLayout() — the bubble moved or changed; a shell may need new hit regions
 *   onFrame(desc, sheet, prefs) — a frame was chosen; a shell reports the cell here
 *   onSnapshot(next) — a snapshot was applied; a shell mirrors it
 */
export function createPetController({
  host, canvas, bubble, context, dpr, seed, speedPxPerSec,
  reducedQuery = null, shouldRun = () => true, hooks = {},
}) {
  const index = indexManifest(DEFAULT_MANIFEST)
  const random = createRandom(seed)
  const engine = createEngine({ index, random })
  // All pacing, priority, sleep, bubble and click decisions live in the shared behaviour.
  const behavior = createBehavior({ index, engine, random })
  // Strolls are rare: one every 20–40 minutes, at most two starts per hour.
  const wanderer = createWanderer({ random, speedPxPerSec })

  let prefs = normalisePrefs(null)
  let lastPrefs = prefs
  let lastUsage = null
  let wanderEnabled = prefs.wander
  let wasWalking = false
  let lastBusy = false

  const reduced = () => prefs.reducedMotion || (reducedQuery !== null && reducedQuery.matches === true)

  // Sheets load on first use: the base atlas alone is enough until a scene reaches for a prop.
  // The active skin is part of the URL, so a skin switch simply loads a different set.
  const ensureSheet = createSheetLoader({
    index,
    engine,
    sheetUrl: (sheet) => skinSheetUrl(prefs.skin, sheet),
    onLoaded: () => draw(Date.now()),
  })

  const draw = createCanvasRenderer({
    engine, index, canvas, context, dpr, ensureSheet,
    isHidden: () => host.hidden,
    onFrame: (desc, sheet) => {
      const bottom = `${bubbleBottomPx(prefs.size, prefs.skin, desc)}px`
      if (host.style.getPropertyValue('--bffg-bubble-bottom') !== bottom) {
        host.style.setProperty('--bffg-bubble-bottom', bottom)
        hooks.onLayout?.()
      }
      host.dataset.mood = desc.animId
      host.dataset.sheet = desc.sheet
      const activeAct = engine.activeAct()
      host.dataset.act = activeAct === null ? '' : (activeAct.animId ?? activeAct.sceneId ?? '')
      hooks.onFrame?.(desc, sheet, prefs)
    },
  })

  function setBubble(text, tone = 'normal', title = '') {
    const wasHidden = bubble.hidden
    const before = bubble.textContent
    if (text === null) {
      bubble.hidden = true
    } else {
      if (bubble.dataset.tone !== tone) bubble.dataset.tone = tone
      if ((bubble.title ?? '') !== title) bubble.title = title
      if (bubble.textContent !== text) bubble.textContent = text
      bubble.hidden = false
    }
    if (bubble.hidden !== wasHidden || bubble.textContent !== before) hooks.onLayout?.()
  }

  /** Bubble text, tone and the wallet tooltip with real token counts, when there are any. */
  function refreshBubble(now) {
    const content = bubbleContent(behavior, prefs, lastUsage, now)
    setBubble(content.text, content.tone, content.title)
  }

  /** Apply the settings the host publishes; nothing about them is stored on the page. */
  function applyPrefs(next) {
    const previous = prefs
    prefs = normalisePrefs(next)
    if (prefs.skin !== previous.skin) {
      ensureSheet.reset()
      engine.setGaze(null)
    }
    applySizeVars(host, prefs.size)
    host.style.opacity = String(prefs.opacity)
    host.dataset.reduced = String(reduced())
    applyRendererPrefs({ engine, behavior, prefs, reduced: reduced() })
    wanderEnabled = prefs.wander
    if (!wanderEnabled) wanderer.rest(Date.now())
    hooks.onPrefs?.(prefs)
  }

  /**
   * One stroll step: walk along the current line, or stand and rest. The gate is the meaning
   * (`behavior.isQuiet`), not the drawn frame: the walking pose is `runLeft`/`runRight`, and
   * gating on that used to stop each stroll on the frame it started.
   * @returns the step `{ dx, facing, walking }`, or null when she may not walk now.
   */
  function applyWander(now) {
    if (hooks.walkGate?.()) return null
    if (!wanderEnabled || !behavior.isQuiet(now)) {
      engine.setMoving(null)
      wanderer.rest(now)
      host.dataset.walking = 'false'
      wasWalking = false
      return null
    }
    const bounds = hooks.walkBounds?.() ?? null
    if (bounds === null) {
      engine.setMoving(null)
      return null
    }
    wanderer.setBounds(bounds, now)
    const move = wanderer.step(now)
    if (!move.walking) {
      engine.setMoving(null)
      if (wasWalking) hooks.onWalkEnd?.()
      host.dataset.walking = 'false'
      wasWalking = false
      return move
    }
    engine.setMoving(move.facing)
    hooks.moveWalk?.(move)
    host.dataset.walking = 'true'
    wasWalking = true
    return move
  }

  const frameLoop = createFrameLoop({
    onFrame: () => {
      const now = Date.now()
      const desc = draw(now)
      lastBusy = desc !== null && desc.animId !== 'idle'
      behavior.update(now, { busy: (hooks.busy?.() ?? false) || host.dataset.walking === 'true' })
      applyWander(now)
      refreshBubble(now)
    },
    interval: () => frameIntervalMs({ reduced: reduced(), busy: lastBusy }),
    shouldRun,
  })

  function applySnapshot(next, changed) {
    const now = Date.now()
    if (!samePrefs(lastPrefs, next.prefs)) {
      lastPrefs = next.prefs
      applyPrefs(next.prefs)
    }
    lastUsage = next.usage ?? null
    behavior.applySnapshot(next, changed, now)
    refreshBubble(now)
    hooks.onSnapshot?.(next)
    draw(now)
  }

  const onMotionChange = () => {
    engine.setReducedMotion(reduced())
    draw(Date.now())
  }
  if (reducedQuery !== null && typeof reducedQuery.addEventListener === 'function') {
    reducedQuery.addEventListener('change', onMotionChange)
  }

  return {
    engine,
    behavior,
    wanderer,
    draw,
    refreshBubble,
    applyPrefs,
    applySnapshot,
    applyWander,
    getPrefs: () => ({ ...prefs }),
    setWander(on) {
      wanderEnabled = on !== false
      if (!wanderEnabled) wanderer.rest(Date.now())
      return wanderEnabled
    },
    wandering: () => wanderEnabled,
    start() {
      behavior.start(Date.now())
      frameLoop.resume()
    },
    pause: () => frameLoop.pause(),
    resume: () => frameLoop.resume(),
    stop() {
      frameLoop.stop()
      if (reducedQuery !== null && typeof reducedQuery.removeEventListener === 'function') {
        reducedQuery.removeEventListener('change', onMotionChange)
      }
    },
  }
}
