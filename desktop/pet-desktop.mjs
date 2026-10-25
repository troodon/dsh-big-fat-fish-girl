// Desktop surface: the same controller as the in-page overlay, drawn into a transparent window.
//
// A native shell (Tauri, or even a plain browser tab) loads this page and talks to it through
// `window.__BFFG_SHELL__`. When that bridge is absent everything still works — dragging then
// moves the pet inside the page, which makes the page previewable in any browser.
//
// User-facing settings live in the plugin's Harness settings and arrive through the snapshot;
// this page has no menu of its own. The shell's native menu keeps only shell actions (hide,
// quit) with labels passed from the i18n module.
//
// Shell contract (all optional, all may be injected before this script runs):
//
//   window.__BFFG_SHELL__ = {
//     moveBy(dx, dy)      // move the OS window by a page-pixel delta (y grows down)
//     menu(x, y, labels)  // open a native context menu; labels come from this page
//     setSize(px)         // request a new pet size; the page calls it back with size
//     quit()              // close the companion for this run
//     state(snapshot)     // optional: mirror of every snapshot, for the native menu
//     frame(cell)         // current sheet cell, for alpha hit-testing
//     openTarget(target)  // optional: focus the Harness window after a navigation click
//     interactiveRegions(regions)
//                         // optional: visible pet/bubble rectangles for hit-testing
//     onDragMove(listener) // optional: subscribe to native drag deltas; returns an unsubscribe
//     startDrag(session, grabbedX, grabbedY)
//                         // optional: Promise<boolean>, true only after native takeover
//     endDrag(session)     // optional: stop that native drag session
//   }
//
// The other direction — shell to page — is `window.__BFFG_DESKTOP_CMD__`: `play`,
// `setSize`, `setVisible`, `setBounds`, `setPosition`, `setWander`. The last three drive
// autonomous wandering: the page decides how far to walk, the shell where the screen ends.
import { DEFAULT_LOCALE, LOCALES } from '../lib/i18n/lines.mjs'
import { API_PREFIX } from '../lib/protocol/contract.mjs'
import { gazeIndexFromPoint, gazeProfileForSkin } from '../lib/animation/gaze.mjs'
import { bubbleCss } from '../lib/rendering/bubble-layout.mjs'
import { DEFAULT_PREFS, normalisePrefs } from '../lib/settings/prefs.mjs'
import { uiFor } from '../lib/i18n/strings.mjs'
import { reportOnce } from '../lib/diagnostics.mjs'
import { applySizeVars, createPetController } from '../lib/web/pet-controller.mjs'
import { createTransport } from '../lib/web/transport.mjs'
import { exposeDebugSurface } from '../lib/web/debug-surface.mjs'
import { createDragController } from './pet-drag.mjs'

export const name = 'big-fat-fish-girl-desktop'

function shellBridge() {
  const bridge = globalThis.__BFFG_SHELL__
  return bridge && typeof bridge === 'object' ? bridge : null
}

/**
 * Call one method of the native shell. The shell is optional, so a missing method is not an
 * error. A method that exists and fails is reported once, and the page carries on.
 */
function shellCall(method, call) {
  try {
    return call()
  } catch (error) {
    reportOnce(`shell bridge ${method} failed`, error)
    return undefined
  }
}

function param(name, fallback) {
  try {
    const value = new URL(globalThis.location?.href ?? 'http://local/').searchParams.get(name)
    return value === null || value === '' ? fallback : value
  } catch {
    // A malformed page URL means no parameters: the defaults apply, and nothing is lost.
    return fallback
  }
}

function reducedMotionQuery() {
  if (typeof matchMedia !== 'function') return null
  try {
    return matchMedia('(prefers-reduced-motion: reduce)')
  } catch (error) {
    reportOnce('reduced-motion query unavailable', error)
    return null
  }
}

export function start(options = {}) {
  if (typeof document === 'undefined') return () => {}
  if (!document.body) {
    // Same lesson as the in-page overlay: never bail out silently when the
    // document is not ready — wait for it and then mount.
    let dispose = null
    let cancelled = false
    const onReady = () => { if (!cancelled) dispose = start(options) }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', onReady, { once: true })
    else onReady()
    return () => {
      cancelled = true
      document.removeEventListener('DOMContentLoaded', onReady)
      if (typeof dispose === 'function') dispose()
    }
  }
  const bridge = shellBridge()
  // The URL parameters are only the pre-snapshot fallback; the plugin settings win.
  const urlSize = Number(param('size', options.size ?? DEFAULT_PREFS.size))
  const urlLocale = param('locale', options.locale ?? DEFAULT_LOCALE)
  const initialSize = Number.isFinite(urlSize) ? urlSize : DEFAULT_PREFS.size
  const initialPrefs = normalisePrefs({
    ...DEFAULT_PREFS,
    size: initialSize,
    locale: LOCALES.includes(urlLocale) ? urlLocale : DEFAULT_PREFS.locale,
  })

  const style = document.createElement('style')
  style.textContent = [
    ':root, html, body { margin: 0; padding: 0; background: transparent; overflow: hidden; width: 100%; height: 100%; }',
    'body { display: flex; align-items: flex-end; justify-content: center; -webkit-user-select: none; user-select: none; }',
    '[data-bffg-desktop] { position: relative; width: var(--bffg-size); height: var(--bffg-canvas-side); }',
    '[data-bffg-desktop] canvas { position: absolute; left: var(--bffg-canvas-left); bottom: 0; width: var(--bffg-canvas-side); height: var(--bffg-canvas-side); display: block; cursor: grab; -webkit-user-drag: none; }',
    '[data-bffg-desktop][data-dragging="true"] canvas { cursor: grabbing; }',
    bubbleCss('[data-bffg-desktop] .bffg-bubble'),
  ].join('\n')
  document.head.appendChild(style)

  const host = document.createElement('div')
  host.setAttribute('data-bffg-desktop', '')
  applySizeVars(host, initialSize)

  const canvas = document.createElement('canvas')
  canvas.setAttribute('aria-hidden', 'true')
  const bubble = document.createElement('div')
  bubble.className = 'bffg-bubble'
  bubble.setAttribute('role', 'status')
  bubble.setAttribute('aria-live', 'polite')
  bubble.hidden = true
  host.append(canvas, bubble)
  document.body.append(host)

  const ctx = typeof canvas.getContext === 'function' ? canvas.getContext('2d', { alpha: true }) : null
  const dpr = Math.min(2, Math.max(1, globalThis.devicePixelRatio || 1))

  let windowBounds = null     // allowed window-origin range, reported by the shell
  let lastCell = null
  let dragController = null   // created below; the hooks only run once the pet starts

  /**
   * Tell the shell where the interactive parts are (the pet and the bubble), not just the
   * sprite cell: a visible bubble must be clickable, and transparent page space must pass
   * clicks through to the window below.
   */
  function reportRegions() {
    if (bridge === null || typeof bridge.interactiveRegions !== 'function') return
    const rectOf = (node) => {
      if (node === null || node.hidden === true) return null
      const rect = node.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) return null
      return { x: rect.left, y: rect.top, width: rect.width, height: rect.height }
    }
    shellCall('interactiveRegions', () => bridge.interactiveRegions({
      // The shell hit-tests the sprite alpha inside this rect; the bubble is
      // interactive even where the sprite is transparent.
      petRect: rectOf(canvas),
      bubbleRects: [rectOf(bubble)].filter(Boolean),
      dragging: dragController !== null && dragController.active(),
    }))
  }

  const pet = createPetController({
    host, canvas, bubble, context: ctx, dpr,
    seed: Date.now() % 2147483647,
    speedPxPerSec: 46,
    reducedQuery: reducedMotionQuery(),
    hooks: {
      walkGate: () => dragController.active(),
      busy: () => dragController.active(),
      // Only walk the window where the shell says the screen ends: better to stand still than
      // to stroll off the edge of the display. Without a shell the page walks inside itself.
      walkBounds: () => (bridge === null
        ? { min: 0, max: Math.max(0, (globalThis.innerWidth || 320) - host.offsetWidth) }
        : windowBounds),
      moveWalk: (move) => {
        if (bridge !== null && typeof bridge.moveBy === 'function') {
          shellCall('moveBy', () => bridge.moveBy(move.dx, 0))
        } else {
          host.style.position = 'absolute'
          host.style.left = `${pet.wanderer.position()}px`
        }
      },
      onLayout: () => reportRegions(),
      onPrefs: () => reportRegions(),
      onFrame: (desc, sheet, prefs) => {
        // The skin is part of the key: the shell re-decodes the atlas when it changes.
        const cell = `${prefs.skin}:${desc.sheet}:${desc.row}:${desc.column}:${desc.flipX === true}`
        if (cell === lastCell) return
        lastCell = cell
        // The shell needs the current cell to hit-test transparent pixels, so it is reported
        // whenever it changes rather than on every frame.
        if (bridge !== null && typeof bridge.frame === 'function') {
          shellCall('frame', () => bridge.frame({
            skin: prefs.skin,
            sheet: desc.sheet,
            row: desc.row,
            column: desc.column,
            flipX: desc.flipX === true,
            columns: sheet.columns,
            rows: sheet.rows,
            cellWidth: sheet.cellWidth,
            cellHeight: sheet.cellHeight,
          }))
        }
      },
      onSnapshot: (next) => {
        if (bridge !== null && typeof bridge.state === 'function') {
          shellCall('state', () => bridge.state(next))
        }
      },
    },
  })

  /** Open the pinned request: ask the host to tell the in-page client, and focus Harness. */
  function navigate(action) {
    const targetRef = typeof action?.targetRef === 'string' ? action.targetRef : ''
    if (targetRef === '') return false
    // The host accepts only refs that are open right now (allow-list on its side).
    const request = () => globalThis.fetch(`${API_PREFIX}/navigate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ targetRef }),
    })
    try {
      request().catch((error) => reportOnce('navigate request failed', error))
    } catch (error) {
      reportOnce('navigate request failed', error)
    }
    if (bridge !== null && typeof bridge.openTarget === 'function') {
      shellCall('openTarget', () => bridge.openTarget({ targetRef, kind: action.requestKind ?? action.kind ?? 'task' }))
    }
    host.dataset.navigation = 'requested'
    return true
  }

  /** Labels for the native shell menu: shell actions only, text from the i18n module. */
  function menuLabels() {
    const ui = uiFor(pet.getPrefs().locale)
    return { reconnect: ui.menuReconnect, reset: ui.menuReset, hide: ui.menuHide, quit: ui.menuQuit }
  }

  function openMenu() {
    if (bridge === null || typeof bridge.menu !== 'function') return
    shellCall('menu', () => bridge.menu(0, 0, menuLabels()))
  }

  function moveDragFallback(dx, dy) {
    if (bridge !== null && typeof bridge.moveBy === 'function') {
      shellCall('moveBy', () => bridge.moveBy(dx, dy))
    } else {
      const left = Number.parseFloat(host.style.left || '0') + dx
      const top = Number.parseFloat(host.style.top || '0') + dy
      host.style.position = 'absolute'
      host.style.left = `${left}px`
      host.style.top = `${top}px`
    }
  }

  dragController = createDragController({
    canvas, bridge,
    onDirection(direction) {
      pet.engine.setMoving(direction)
      pet.engine.setGaze(null)
      pet.draw(Date.now())
    },
    onFallbackMove(dx, dy) { moveDragFallback(dx, dy) },
    onDragging(dragging) {
      host.dataset.dragging = dragging ? 'true' : 'false'
      reportRegions()
    },
    onFreeMove(event) {
      const rect = canvas.getBoundingClientRect()
      const profile = gazeProfileForSkin(pet.getPrefs().skin)
      pet.engine.setGaze(gazeIndexFromPoint(
        event.clientX - (rect.left + rect.width / 2),
        event.clientY - (rect.top + rect.height / 2),
        profile,
      ), profile)
      pet.draw(Date.now())
    },
    onClick() {
      // A drag never navigates; a clean click does whatever the priority says.
      const action = pet.behavior.clickAction()
      if (action.kind === 'navigate') navigate(action)
      else pet.behavior.react(Date.now())
      pet.draw(Date.now())
    },
  })

  canvas.addEventListener('pointerleave', () => { pet.engine.setGaze(null); pet.draw(Date.now()) })
  // Any press wakes her, even before it counts as a drag.
  canvas.addEventListener('pointerdown', () => pet.engine.setSleeping(false))
  canvas.addEventListener('pointerenter', () => {
    const now = Date.now()
    pet.behavior.hover(now)
    pet.refreshBubble(now)
  })
  canvas.addEventListener('contextmenu', (event) => { event.preventDefault(); openMenu() })
  bubble.addEventListener('click', () => {
    const action = pet.behavior.clickAction()
    if (action.kind === 'navigate') navigate(action)
  })

  const commands = installCommands(pet.engine, host, {
    /** The shell reports where the window may walk (screen visible area minus its size). */
    setBounds(bounds) {
      if (bounds === null || typeof bounds !== 'object') return false
      const min = Number(bounds.minX)
      const max = Number(bounds.maxX)
      if (!Number.isFinite(min) || !Number.isFinite(max)) return false
      windowBounds = { min, max: Math.max(min, max) }
      pet.wanderer.setBounds(windowBounds, Date.now())
      return true
    },
    /** The shell reports the real window origin after moving, so the walk stays in sync. */
    setPosition(x) {
      if (!Number.isFinite(Number(x))) return false
      pet.wanderer.setPosition(Number(x), Date.now())
      return true
    },
    setWander(on) {
      return pet.setWander(on)
    },
    /** Self-tests and debug: ignore the 20–40 minute wait and stroll now. */
    forceStroll() {
      pet.wanderer.forceStroll(Date.now())
      return true
    },
  })

  pet.applyPrefs(initialPrefs)
  // Documented debug surface: the smoke tests drive behaviour deterministically through it.
  // It opens only for a page that opts in, so a production page exposes nothing.
  exposeDebugSurface({
    engine: pet.engine,
    behavior: pet.behavior,
    wanderer: pet.wanderer,
    applyPrefs: pet.applyPrefs,
    applyWander: pet.applyWander,
    applySnapshot: pet.applySnapshot,
    draw: pet.draw,
    navigate,
    commands,
  })
  reportRegions()
  const onResize = () => reportRegions()
  globalThis.addEventListener('resize', onResize)
  pet.start()
  const transport = createTransport({ onSnapshot: pet.applySnapshot, surface: 'desktop' })
  transport.start()

  function stop() {
    pet.stop()
    transport.stop()
    dragController.dispose()
    globalThis.removeEventListener('resize', onResize)
    host.remove()
    style.remove()
  }

  return stop
}

/**
 * Commands the shell may call into the page (native menu, hotkeys). Kept separate
 * from `__BFFG_SHELL__`, which goes the other way round.
 */
export function installCommands(engine, host, extra = {}, target = globalThis) {
  target.__BFFG_DESKTOP_CMD__ = {
    play(anim = 'wave', ms = 1200) { engine.playAct(anim, ms, { force: true }) },
    setSize(px) {
      const next = Number(px)
      if (!Number.isFinite(next) || next < 48 || next > 512) return false
      applySizeVars(host, next)
      return true
    },
    setVisible(visible) { host.style.visibility = visible ? '' : 'hidden' },
    ...extra,
  }
  return target.__BFFG_DESKTOP_CMD__
}

/** Expose the surface for the shell page loader and for the smoke test. */
export function install(target = globalThis) {
  target.__BFFG_DESKTOP__ = { start }
  return start
}

// Bundled as a classic script, so it has to publish itself for the page loader.
install(typeof globalThis === 'object' ? globalThis : {})
