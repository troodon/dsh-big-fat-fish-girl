// Pointer input for the in-page overlay: dragging the element, cursor gaze and clicks.
// The surface keeps the DOM; this keeps the listeners and the drag state, so the mount
// function reads as wiring instead of event bookkeeping.
import { gazeIndexFromPoint } from '../animation/gaze.mjs'
import { reportOnce } from '../diagnostics.mjs'

/** A press becomes a drag only past this distance; below it, it is a click. */
export const DRAG_THRESHOLD_PX = 6

export function attachOverlayInput({
  stage, bubble, canvas, host,
  engine, behavior,
  navigate, setPosition, clampPosition, savePosition, draw, refreshBubble,
  getGazeProfile = () => null,
  threshold = DRAG_THRESHOLD_PX,
}) {
  let drag = null
  let skipClick = false

  function onStageClick() {
    if (skipClick) { skipClick = false; return }
    const action = behavior.clickAction()
    if (action.kind === 'navigate') {
      navigate(action)
      return
    }
    behavior.react(Date.now())
    draw(Date.now())
  }

  function onBubbleClick(event) {
    event.stopPropagation()
    const action = behavior.clickAction()
    if (action.kind === 'navigate') navigate(action)
  }

  function onContextMenu(event) {
    event.preventDefault()
  }

  function onStageEnter() {
    const now = Date.now()
    behavior.hover(now)
    refreshBubble(now)
    draw(now)
  }

  function onPointerMove(event) {
    if (drag !== null && drag.pointerId === event.pointerId) {
      const dx = event.clientX - drag.startX
      const dy = event.clientY - drag.startY
      if (!drag.moved && Math.hypot(dx, dy) > threshold) {
        drag.moved = true
        try { stage.setPointerCapture(event.pointerId) } catch (error) { reportOnce('pointer capture refused', error) }
      }
      if (drag.moved) {
        const direction = event.clientX < drag.lastX ? 'left' : 'right'
        drag.lastX = event.clientX
        engine.setMoving(direction)
        engine.setGaze(null)
        setPosition(drag.originX + dx, drag.originY + dy, false)
        draw(Date.now())
        event.preventDefault()
      }
      return
    }
    if (drag !== null) return
    const rect = canvas.getBoundingClientRect()
    const profile = getGazeProfile()
    engine.setGaze(gazeIndexFromPoint(
      event.clientX - (rect.left + rect.width / 2),
      event.clientY - (rect.top + rect.height / 2),
      profile,
    ), profile)
  }

  function onPointerLeave() {
    if (drag === null) {
      engine.setGaze(null)
      draw(Date.now())
    }
  }

  function onPointerDown(event) {
    if (event.button !== 0) return
    const rect = host.getBoundingClientRect()
    drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: rect.left,
      originY: rect.top,
      lastX: event.clientX,
      moved: false,
    }
  }

  function onPointerUp(event) {
    if (drag === null || drag.pointerId !== event.pointerId) return
    if (drag.moved) {
      skipClick = true
      savePosition(clampPosition(host.offsetLeft, host.offsetTop))
      setTimeout(() => { skipClick = false }, 0)
    }
    drag = null
    engine.setMoving(null)
    draw(Date.now())
  }

  const listeners = [
    [stage, 'click', onStageClick],
    [bubble, 'click', onBubbleClick],
    [stage, 'contextmenu', onContextMenu],
    [stage, 'pointerenter', onStageEnter],
    [stage, 'pointerleave', onPointerLeave],
    [stage, 'pointermove', onPointerMove],
    [stage, 'pointerdown', onPointerDown],
    [stage, 'pointerup', onPointerUp],
    [stage, 'pointercancel', onPointerUp],
  ]
  for (const [node, type, handler] of listeners) node.addEventListener(type, handler)

  return {
    active: () => drag !== null,
    dispose() {
      for (const [node, type, handler] of listeners) node.removeEventListener(type, handler)
      drag = null
    },
  }
}
