// In-page chrome: the DOM, the pointer and the window. The shared controller decides what the
// pet does (lib/web/pet-controller.mjs, with the rules in lib/core); every user-facing setting
// lives in the plugin's Harness settings, and the host publishes them in each snapshot. The
// pet itself has no menu.
//
// Everything here degrades safely: the pet is decoration, never a source of errors for the
// host page.
import { attachOverlayInput } from './overlay-input.mjs'
import { createPetController } from './pet-controller.mjs'
import { createTransport } from './transport.mjs'
import { attachSettings } from './settings-ui.mjs'
import { gazeProfileForSkin } from '../animation/gaze.mjs'
import { bubbleCss } from '../rendering/bubble-layout.mjs'
import { reportOnce } from '../diagnostics.mjs'
import { exposeDebugSurface } from './debug-surface.mjs'

export const name = 'big-fat-fish-girl'

/** Only the pet's position stays local: it is per-window, not a preference. */
const POSITION_KEY = 'big-fat-fish-girl:position:v1'

const CSS = [
  '[data-bffg] { --bffg-size: 132px; position: fixed; right: 16px; bottom: 12px; z-index: 2147483000; width: var(--bffg-size); height: calc(var(--bffg-size) * 1.43); pointer-events: none; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }',
  '[data-bffg] *, [data-bffg] *::before, [data-bffg] *::after { box-sizing: border-box; }',
  '[data-bffg] .bffg-stage { position: absolute; right: 0; bottom: 0; width: var(--bffg-size); aspect-ratio: 192 / 256; padding: 0; border: 0; outline: 0; background: transparent; pointer-events: auto; cursor: grab; touch-action: none; -webkit-tap-highlight-color: transparent; }',
  '[data-bffg] .bffg-stage:active { cursor: grabbing; }',
  '[data-bffg] .bffg-stage:focus-visible { outline: 2px solid #83cbff; outline-offset: 3px; border-radius: 24px; }',
  '[data-bffg] .bffg-halo { position: absolute; inset: 15% 10% 10%; border-radius: 50%; background: radial-gradient(ellipse, rgba(90,174,255,.20), rgba(90,174,255,0) 72%); opacity: 0; transition: opacity .25s ease; pointer-events: none; }',
  '[data-bffg] .bffg-stage:hover .bffg-halo, [data-bffg] .bffg-stage:focus-visible .bffg-halo { opacity: 1; }',
  // The button keeps the old 192:256 hit rectangle. A centered square canvas preserves
  // the character's screen position and pixel scale while adding transparent side space.
  '[data-bffg] canvas { position: absolute; left: var(--bffg-canvas-left); bottom: 0; width: var(--bffg-canvas-side); height: var(--bffg-canvas-side); filter: drop-shadow(0 8px 9px rgba(15,34,77,.18)); pointer-events: none; }',
  bubbleCss('[data-bffg] .bffg-status'),
  // A clamped pet stays at least 8px from the viewport edge; limit the overhang to 8px.
  '[data-bffg] .bffg-status { max-width: min(220px, calc(var(--bffg-size) + 16px), calc(100vw - 16px)); animation: bffg-pop .18s ease-out; }',
  // Amber like the harness approval notice: she needs you, something broke, or files
  // and commands are being changed. Colour never carries the meaning alone — the text does.
  '[data-bffg][data-reduced="true"] .bffg-halo, [data-bffg][data-reduced="true"] .bffg-status { animation: none; transition: none; }',
  '@keyframes bffg-pop { from { opacity: 0; transform: translate(-50%, 4px) scale(.98); } to { opacity: 1; transform: translateX(-50%); } }',
  '@media (prefers-reduced-motion: reduce) { [data-bffg] .bffg-halo, [data-bffg] .bffg-status { animation: none; transition: none; } }',
].join(' ')

function element(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function loadPosition() {
  try {
    const stored = JSON.parse(localStorage.getItem(POSITION_KEY) || '{}')
    return Number.isFinite(stored.x) && Number.isFinite(stored.y) ? { x: stored.x, y: stored.y } : null
  } catch (error) {
    // Storage that cannot be read costs the saved place, not the pet: it appears in its corner.
    reportOnce('saved pet position unreadable', error)
    return null
  }
}

export function apply(pluginCtx) {
  // Settings live in Harness's own panel: register our section there (no-op on hosts
  // without the slots/configForms services — the pet itself never depends on it).
  attachSettings(pluginCtx)
  if (typeof document === 'undefined') return () => {}
  // DSH applies client modules without injections while the document is still in
  // <head>, so `document.body` may not exist yet. Waiting for the DOM is mandatory:
  // bailing out here is what silently disabled the pet in the first release.
  if (document.body) return mount(pluginCtx)
  let dispose = null
  let cancelled = false
  const onReady = () => { if (!cancelled) dispose = mount(pluginCtx) }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', onReady, { once: true })
  else onReady()
  return () => {
    cancelled = true
    document.removeEventListener('DOMContentLoaded', onReady)
    if (typeof dispose === 'function') dispose()
  }
}

/**
 * The navigation service, when the host provides one. DeepSeek Harness exposes
 * `uiWorkspace.openSession(sessionId)`; on older hosts (and in the preview) the pet
 * stays fully alive, it just cannot open the form by itself.
 */
function navigationService(pluginCtx) {
  try {
    if (typeof pluginCtx?.get === 'function') return pluginCtx.get('uiWorkspace') ?? null
    return pluginCtx?.uiWorkspace ?? null
  } catch {
    return null
  }
}

function mount(pluginCtx) {
  if (document.querySelector('[data-bffg]')) return () => {}
  const position = loadPosition()
  const reducedQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null

  const style = element('style')
  style.textContent = CSS
  document.head.appendChild(style)

  const host = element('div')
  host.setAttribute('data-bffg', '')
  host.setAttribute('role', 'group')
  const stage = element('button', 'bffg-stage')
  stage.type = 'button'
  stage.setAttribute('aria-label', 'Big Fat Fish Girl')
  const halo = element('span', 'bffg-halo')
  const canvas = element('canvas')
  canvas.setAttribute('aria-hidden', 'true')
  stage.append(halo, canvas)
  const bubble = element('div', 'bffg-status')
  bubble.setAttribute('role', 'status')
  bubble.setAttribute('aria-live', 'polite')
  host.append(stage, bubble)
  document.body.append(host)

  const ctx = canvas.getContext('2d', { alpha: true })
  const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1))
  if (ctx) ctx.imageSmoothingEnabled = true

  const workspace = navigationService(pluginCtx)
  // The pointer is created after the controller; the hooks below only run once it starts.
  let input = null

  // Strolling along the pet's current line. Only x moves, so she never walks over the rest of
  // the interface; the walkway is the viewport width minus the pet itself.
  const pet = createPetController({
    host, canvas, bubble, context: ctx, dpr,
    seed: Date.now() % 2147483647,
    speedPxPerSec: 42,
    reducedQuery,
    shouldRun: () => document.visibilityState !== 'hidden',
    hooks: {
      // The pointer holds her still and counts as work for the behaviour.
      walkGate: () => input.active(),
      busy: () => input.active(),
      walkBounds: () => ({ min: 8, max: Math.max(24, window.innerWidth - host.getBoundingClientRect().width - 8) }),
      moveWalk: () => setPosition(pet.wanderer.position(), host.getBoundingClientRect().top, false),
      onWalkEnd: () => savePosition(clampPosition(host.offsetLeft, host.offsetTop)),
      onPrefs: () => {
        // Keep the pet where the user (or a stroll) left it, not where it was at mount.
        const here = currentPosition()
        if (here !== null) setPosition(here.x, here.y, false)
        pet.wanderer.setPosition(host.getBoundingClientRect().left, Date.now())
      },
    },
  })

  // ---- state ------------------------------------------------------------

  /** Where the pet stands right now, or null while it still sits in its default corner. */
  function currentPosition() {
    if (host.style.left === '' || host.style.top === '') return null
    return { x: parseFloat(host.style.left), y: parseFloat(host.style.top) }
  }

  function savePosition(point) {
    try {
      if (point === null) localStorage.removeItem(POSITION_KEY)
      else localStorage.setItem(POSITION_KEY, JSON.stringify(point))
    } catch (error) {
      reportOnce('pet position not saved', error)
    }
  }

  function clampPosition(x, y) {
    const rect = host.getBoundingClientRect()
    return {
      x: clamp(x, 8, Math.max(8, window.innerWidth - rect.width - 8)),
      y: clamp(y, 8, Math.max(8, window.innerHeight - rect.height - 8)),
    }
  }

  function setPosition(x, y, save = true) {
    const point = clampPosition(x, y)
    host.style.left = point.x + 'px'
    host.style.top = point.y + 'px'
    host.style.right = 'auto'
    host.style.bottom = 'auto'
    if (save) savePosition(point)
  }

  function resetPosition() {
    host.style.left = ''
    host.style.top = ''
    host.style.right = '16px'
    host.style.bottom = '12px'
    savePosition(null)
  }

  // ---- behaviour ---------------------------------------------------------

  /**
   * Open the pinned target: the session id is opaque, and the host-side navigator accepts only
   * refs that are open right now. Without a navigation service the pet stays alive and the
   * limitation is visible in the DOM, not silent.
   */
  function navigate(action) {
    const targetRef = typeof action?.targetRef === 'string' ? action.targetRef : ''
    if (targetRef === '') return false
    if (workspace !== null && typeof workspace.openSession === 'function') {
      try {
        workspace.openSession(targetRef)
        host.dataset.navigation = 'opened'
        return true
      } catch (error) {
        // The dataset below keeps the limitation visible; the cause is reported once.
        reportOnce('navigation failed', error)
      }
    }
    host.dataset.navigation = 'unavailable'
    return false
  }

  // ---- interaction and transport ----------------------------------------

  input = attachOverlayInput({
    stage, bubble, canvas, host,
    engine: pet.engine, behavior: pet.behavior,
    getGazeProfile: () => gazeProfileForSkin(pet.getPrefs().skin),
    navigate, setPosition, clampPosition, savePosition,
    draw: pet.draw, refreshBubble: pet.refreshBubble,
  })

  const applySnapshot = (next, changed) => {
    // A desktop shell owns the pet while it is connected: hide the in-window one instead of
    // drawing the character twice. Hiding is also a drawing guard, so nothing keeps animating.
    const shellOwns = next.shellActive === true
    if (host.hidden !== shellOwns) {
      host.hidden = shellOwns
      host.style.display = shellOwns ? 'none' : ''
    }
    pet.applySnapshot(next, changed)
  }

  const transport = createTransport({
    onSnapshot: applySnapshot,
    // A request issued from the desktop shell (or another surface) arrives here; the in-page
    // client is the one that can actually open the Harness form.
    onNavigate: (message) => navigate({ kind: 'navigate', targetRef: message?.targetRef }),
  })

  const onWindowResize = () => {
    const saved = loadPosition()
    if (saved) setPosition(saved.x, saved.y, false)
    pet.wanderer.setPosition(host.getBoundingClientRect().left, Date.now())
  }
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') pet.pause()
    else pet.resume()
  }
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('resize', onWindowResize)

  pet.applyPrefs(pet.getPrefs())
  if (position) setPosition(position.x, position.y, false)
  else resetPosition()
  pet.wanderer.setPosition(host.getBoundingClientRect().left, Date.now())

  // Documented debug surface: the smoke tests drive behaviour deterministically through it.
  // It opens only for a page that opts in, so a production page exposes nothing.
  exposeDebugSurface({
    engine: pet.engine,
    behavior: pet.behavior,
    wanderer: pet.wanderer,
    applyPrefs: pet.applyPrefs,
    applyWander: pet.applyWander,
    applySnapshot,
    draw: pet.draw,
    navigate,
    getPrefs: pet.getPrefs,
    setWander: pet.setWander,
    wandering: pet.wandering,
    forceStroll: (now = Date.now()) => pet.wanderer.forceStroll(now),
    wanderStarts: () => pet.wanderer.starts(),
  })
  pet.start()
  transport.start()

  return () => {
    pet.stop()
    transport.stop()
    document.removeEventListener('visibilitychange', onVisibility)
    window.removeEventListener('resize', onWindowResize)
    input.dispose()
    host.remove()
    style.remove()
  }
}
