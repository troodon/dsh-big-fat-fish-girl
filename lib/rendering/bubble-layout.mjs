// Stable top-of-character anchors in the existing 256px logical cells. Each row
// uses one anchor for its whole animation, so a moving head cannot shake the text.
// Measured from the authored runtime art; originals and atlas generation stay separate.
import { canvasSideForSize, REFERENCE_CELL_WIDTH } from './pet-geometry.mjs'
import { SKIN_PROFILES } from '../animation/skin-profiles.mjs'
import { DEFAULT_SKIN } from '../settings/prefs.mjs'

/** Bubble body stops 14 CSS px above the anchor; its 8px tail closes most of the gap. */
export function bubbleBottomPx(size, skin, frame) {
  // The anchors live with each skin in its skin.json; an unknown skin uses the default's.
  const anchors = (SKIN_PROFILES[skin] ?? SKIN_PROFILES[DEFAULT_SKIN]).head
  const top = anchors[frame?.sheet]?.[frame?.row] ?? anchors.base[0]
  return canvasSideForSize(size) - top * Number(size) / REFERENCE_CELL_WIDTH + 14
}

/** Shared balloon shape for the overlay and the desktop WebView. */
export function bubbleCss(selector) {
  return [
    `${selector} { --bffg-bubble-bg: #f7fcff; --bffg-bubble-border: #d4e2ee; position: absolute; left: 50%; transform: translateX(-50%); bottom: var(--bffg-bubble-bottom, calc(100% + 14px)); box-sizing: border-box; width: max-content; min-width: 84px; max-width: min(220px, calc(100vw - 16px)); padding: 7px 11px; border: 1px solid var(--bffg-bubble-border); border-radius: 14px; background: var(--bffg-bubble-bg); box-shadow: 0 6px 20px rgba(31,74,129,.18); color: #193665; font: 12px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; text-align: center; overflow-wrap: anywhere; pointer-events: auto; cursor: pointer; }`,
    `${selector}::after { content: ""; position: absolute; left: 50%; bottom: -6px; width: 10px; height: 10px; box-sizing: border-box; transform: translateX(-50%) rotate(45deg); background: var(--bffg-bubble-bg); border-right: 1px solid var(--bffg-bubble-border); border-bottom: 1px solid var(--bffg-bubble-border); pointer-events: none; }`,
    `${selector}[data-tone="alert"] { --bffg-bubble-bg: #fff7d6; --bffg-bubble-border: rgba(203,148,40,.85); color: #6b4d00; box-shadow: 0 6px 20px rgba(146,102,12,.24); }`,
    `${selector}[hidden] { display: none; }`,
  ].join('\n')
}
