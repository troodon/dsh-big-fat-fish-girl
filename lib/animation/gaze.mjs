// Cursor-to-direction math, kept pure and separate from rendering.
// Most skins use all 16 authored gaze cells. Compact gaze strips may provide a
// profile that mirrors one half across the opposite direction range.

import { SKIN_PROFILES } from './skin-profiles.mjs'

export const DIRECTIONS = 16
export const STEP_DEGREES = 360 / DIRECTIONS

/** Optional per-skin override for compact gaze strips; full 16-cell atlases need none. */
export function gazeProfileForSkin(skin) {
  return SKIN_PROFILES[skin]?.gaze ?? null
}

/**
 * Map a pointer offset from the pet's centre to a gaze direction.
 * Returns null when there is nothing sensible to look at (or the input is junk).
 */
export function gazeIndexFromPoint(dx, dy, profile = null) {
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || (dx === 0 && dy === 0)) return null
  const degrees = (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360
  const direction = Math.round(degrees / STEP_DEGREES) % DIRECTIONS

  if (profile?.mirrorLeft !== true) return direction

  // Cells 0..7 are authored for the right half of the face. Encode left-side
  // directions as 8..15; gazeCell resolves those to the matching mirrored cell.
  if (direction < DIRECTIONS / 2) return direction
  if (direction === DIRECTIONS / 2) return DIRECTIONS / 2 - 1
  return DIRECTIONS / 2 + (DIRECTIONS - direction)
}
