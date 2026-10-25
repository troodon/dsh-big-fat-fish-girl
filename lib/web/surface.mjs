// The DOM half both browser surfaces share: sheet loading, canvas drawing, the frame
// loop and the bubble text. The in-page overlay and the desktop page keep only what
// actually differs — their wrappers, their input, and what a drag moves.
import { usageTitle } from '../i18n/usage.mjs'
import { API_PREFIX } from '../protocol/contract.mjs'

export const API = API_PREFIX


/**
 * Load sheets on first use: the pet starts with the base atlas alone, so a snack sheet
 * costs nothing until she reaches for it. A sheet that fails marks its animations
 * unavailable instead of leaving a hole. `reset()` drops every cached image and clears
 * those flags — used when the skin changes.
 * @returns `ensureSheet(sheetId)` → the decoded image, or undefined while it loads
 */
export function createSheetLoader({
  index, engine, sheetUrl = (sheet) => skinSheetUrl('', sheet), onLoaded = () => {},
}) {
  const images = new Map()
  const loading = new Set()
  const failed = new Set()

  function setAvailable(sheetId, value) {
    for (const animation of index.animations.values()) {
      if (animation.sheet === sheetId) engine.setUnavailable(animation.id, value)
    }
  }

  function ensureSheet(sheetId) {
    const loaded = images.get(sheetId)
    if (loaded !== undefined) return loaded
    if (loading.has(sheetId)) return undefined
    const sheet = index.sheets[sheetId]
    if (sheet === undefined) return undefined
    loading.add(sheetId)
    const image = new Image()
    image.decoding = 'async'
    image.addEventListener('load', () => {
      loading.delete(sheetId)
      images.set(sheetId, image)
      onLoaded()
    })
    image.addEventListener('error', () => {
      loading.delete(sheetId)
      failed.add(sheetId)
      setAvailable(sheetId, true)
      onLoaded()
    })
    image.src = sheetUrl(sheet, sheetId)
    return undefined
  }

  ensureSheet.reset = () => {
    for (const sheetId of failed) setAvailable(sheetId, false)
    failed.clear()
    images.clear()
    loading.clear()
  }
  return ensureSheet
}

/**
 * Resolve one frame and draw its cell. `onFrame(desc, sheet)` runs after the canvas is
 * sized, before the draw — for surface bookkeeping (datasets, shell reports).
 * @returns the frame description, or null while hidden or nothing can be drawn
 */
export function createCanvasRenderer({
  engine, index, canvas, context, dpr,
  ensureSheet, isHidden = () => false, onFrame = null,
}) {
  return function draw(now) {
    if (isHidden()) return null
    const desc = engine.resolve(now)
    if (desc === null) return null
    const sheet = index.sheets[desc.sheet]
    const image = ensureSheet(desc.sheet)
    const width = Math.round(sheet.cellWidth * dpr)
    const height = Math.round(sheet.cellHeight * dpr)
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width
      canvas.height = height
      if (context) context.imageSmoothingEnabled = true
    }
    if (onFrame !== null) onFrame(desc, sheet)
    if (context && image !== undefined) {
      context.clearRect(0, 0, canvas.width, canvas.height)
      if (desc.flipX === true) {
        context.save()
        context.translate(canvas.width, 0)
        context.scale(-1, 1)
      }
      context.drawImage(
        image,
        desc.column * sheet.cellWidth,
        desc.row * sheet.cellHeight,
        sheet.cellWidth,
        sheet.cellHeight,
        0, 0,
        canvas.width,
        canvas.height,
      )
      if (desc.flipX === true) context.restore()
    }
    return desc
  }
}

/** The bubble text, tone and wallet tooltip the shared controller decided right now. */
export function bubbleContent(behavior, prefs, usage, now) {
  const info = behavior.bubbleInfo(now)
  return {
    text: info === null ? null : info.text,
    tone: info === null ? 'normal' : info.tone,
    title: info !== null && info.pool === 'wallet' ? usageTitle(prefs.locale, usage) : '',
  }
}

/** The renderer-facing half of the settings; each surface keeps its own DOM extras. */
export function applyRendererPrefs({ engine, behavior, prefs, reduced }) {
  engine.setReducedMotion(reduced)
  behavior.setLocale(prefs.locale)
  behavior.features.reactToHover = prefs.hover
  behavior.features.randomActs = prefs.randomActs
  behavior.features.meal = prefs.meal
  behavior.features.wallet = prefs.wallet
}

/** Frame pacing: fewer frames when idle, the floor when reduced motion is on. */
export function frameIntervalMs({ reduced, busy }) {
  const fps = reduced ? 2 : (busy ? 9 : 3)
  return Math.max(80, Math.round(1000 / fps))
}

/**
 * A `setTimeout` frame loop. `shouldRun()` gates scheduling (a hidden tab pauses);
 * `resume()` continues after a pause. The caller owns `onFrame`.
 */
export function createFrameLoop({ onFrame, interval, shouldRun = () => true }) {
  let timer = null
  let stopped = false

  function loop() {
    if (stopped) return
    onFrame()
    if (!stopped && shouldRun()) timer = setTimeout(loop, interval())
    else timer = null
  }

  return {
    resume() {
      if (!stopped && timer === null) loop()
    },
    pause() {
      if (timer !== null) clearTimeout(timer)
      timer = null
    },
    stop() {
      stopped = true
      this.pause()
    },
  }
}
