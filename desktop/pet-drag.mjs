// Pointer-driven window drag for the desktop page.
//
// The shell takes over natively when it can: `startDrag(session, grabbedX, grabbedY)`
// resolves true only after native ownership, `onDragMove(listener)` reports each
// horizontal cursor delta and `endDrag(session)` releases the session. Until then the
// page moves the window itself with the deltas it accumulates. A refused or failed
// takeover flushes those deltas through the page fallback instead of swallowing the
// movement.
//
// The controller owns the pointer listeners and the native subscription; the surface
// only says what a direction change, a fallback move or a clean click should do.
import { reportOnce } from '../lib/diagnostics.mjs'

export const DRAG_THRESHOLD_PX = 6

export function createDragController({
  canvas, bridge,
  onDirection = () => {},     // ('left' | 'right' | null) — the run direction to show
  onFallbackMove = () => {},  // (dx, dy) — move the window while the shell is not doing it
  onDragging = () => {},      // (dragging) — dataset/regions bookkeeping
  onFreeMove = null,          // (event) — a pointer move with no drag in progress
  onClick = null,             // () — a clean press-and-release without movement
  target = globalThis,
}) {
  let drag = null
  let nextSession = 0
  let unlisten = null
  let disposed = false

  function updateDirection(activeDrag, dx) {
    if (!Number.isFinite(dx) || Math.abs(dx) < 0.5) return
    activeDrag.direction = dx < 0 ? 'left' : 'right'
    onDirection(activeDrag.direction)
  }

  function flushPending(activeDrag) {
    const dx = activeDrag.pendingDx
    const dy = activeDrag.pendingDy
    activeDrag.pendingDx = 0
    activeDrag.pendingDy = 0
    if (dx !== 0 || dy !== 0) onFallbackMove(dx, dy)
  }

  function endNative(session) {
    if (bridge === null || typeof bridge.endDrag !== 'function') return Promise.resolve()
    try {
      return Promise.resolve(bridge.endDrag(session))
        .catch((error) => reportOnce('shell bridge endDrag failed', error))
    } catch (error) {
      reportOnce('shell bridge endDrag failed', error)
      return Promise.resolve()
    }
  }

  // The native subscription must exist before takeover is requested: an event sent
  // before it would be lost, and with it a direction reversal.
  const nativeReady = bridge !== null && typeof bridge.onDragMove === 'function'
    ? Promise.resolve()
      .then(() => bridge.onDragMove((payload) => {
        if (drag === null || payload?.session !== drag.session
          || (drag.native !== true && drag.nativePending !== true)) return
        updateDirection(drag, payload.dx)
      }))
      .then((stop) => {
        if (typeof stop !== 'function') return false
        if (disposed) {
          try { stop() } catch (error) { reportOnce('native drag subscription did not stop', error) }
          return false
        }
        unlisten = stop
        return true
      })
      .catch(() => false)
    : Promise.resolve(false)

  function requestNative(activeDrag) {
    if (bridge === null
      || typeof bridge.startDrag !== 'function'
      || typeof bridge.endDrag !== 'function'
      || typeof bridge.onDragMove !== 'function') return
    // How far the cursor already travelled while the page was holding the window
    // still: the shell subtracts it so the grabbed point stays under the cursor.
    const grabbedX = activeDrag.lastScreenX - activeDrag.startScreenX
    const grabbedY = activeDrag.lastScreenY - activeDrag.startScreenY
    activeDrag.nativePending = true
    nativeReady.then((ready) => {
      if (!ready) {
        activeDrag.nativePending = false
        flushPending(activeDrag)
        return
      }
      if (activeDrag.ended === true) return
      return Promise.resolve(bridge.startDrag(activeDrag.session, grabbedX, grabbedY)).then(
        (started) => {
          if (activeDrag.ended === true) {
            if (started === true) endNative(activeDrag.session)
            return
          }
          activeDrag.nativePending = false
          if (started === true) {
            activeDrag.native = true
            activeDrag.pendingDx = 0
            activeDrag.pendingDy = 0
          } else {
            flushPending(activeDrag)
          }
        },
        () => {
          if (activeDrag.ended === true) {
            endNative(activeDrag.session)
            return
          }
          activeDrag.nativePending = false
          // The shell may have taken over before failing: release, then fall back.
          endNative(activeDrag.session).then(() => {
            if (activeDrag.ended !== true) flushPending(activeDrag)
          })
        },
      )
    })
  }

  function onPointerDown(event) {
    if (event.button !== 0) return
    drag = {
      id: event.pointerId,
      startScreenX: event.screenX,
      startScreenY: event.screenY,
      lastScreenX: event.screenX,
      lastScreenY: event.screenY,
      session: ++nextSession,
      pendingDx: 0,
      pendingDy: 0,
      moved: false,
    }
    onDragging(false)
    try { canvas.setPointerCapture(event.pointerId) } catch (error) { reportOnce('pointer capture refused', error) }
  }

  function onPointerMove(event) {
    if (drag === null || drag.id !== event.pointerId) {
      if (onFreeMove !== null) onFreeMove(event)
      return
    }
    // Screen coordinates, not client ones: the window moves under the cursor while we
    // drag it, and client deltas shrink by exactly the distance already travelled.
    const dx = event.screenX - drag.lastScreenX
    const dy = event.screenY - drag.lastScreenY
    drag.lastScreenX = event.screenX
    drag.lastScreenY = event.screenY
    if (!drag.moved
      && Math.hypot(event.screenX - drag.startScreenX, event.screenY - drag.startScreenY) > DRAG_THRESHOLD_PX) {
      drag.moved = true
      onDragging(true)
      requestNative(drag)
    }
    if (drag.moved) {
      if (drag.native !== true) updateDirection(drag, dx)
      if (drag.native === true) {
        event.preventDefault()
        return
      }
      if (drag.nativePending === true) {
        drag.pendingDx += dx
        drag.pendingDy += dy
      } else {
        onFallbackMove(dx, dy)
      }
    }
    event.preventDefault()
  }

  function release(event, clicking) {
    if (drag === null || drag.id !== event.pointerId) return
    const wasClick = drag.moved === false
    const wasNative = drag.native === true
    const session = drag.session
    drag.ended = true
    drag = null
    onDragging(false)
    onDirection(null)
    if (wasNative) endNative(session)
    if (clicking && wasClick && onClick !== null) onClick()
  }

  function abort() {
    if (drag === null) return
    const wasNative = drag.native === true
    const session = drag.session
    drag.ended = true
    drag = null
    onDragging(false)
    onDirection(null)
    if (wasNative) endNative(session)
  }

  const onPointerUp = (event) => release(event, true)
  const onPointerCancel = (event) => release(event, false)

  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointermove', onPointerMove)
  canvas.addEventListener('pointerup', onPointerUp)
  canvas.addEventListener('pointercancel', onPointerCancel)
  target.addEventListener('blur', abort)

  return {
    abort,
    active: () => drag !== null,
    dispose() {
      disposed = true
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointercancel', onPointerCancel)
      target.removeEventListener('blur', abort)
      abort()
      if (unlisten !== null) {
        try { unlisten() } catch (error) { reportOnce('native drag listener did not detach', error) }
        unlisten = null
      }
    },
  }
}
