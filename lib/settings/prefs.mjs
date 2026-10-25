// User-facing preferences: one source of defaults and validation.
//
// The same file is used by the host half (which declares the plugin Config schema and
// publishes the values in every snapshot), by the preview server and by the browser
// bundle. It deliberately imports nothing but the locale list, so the client can bundle
// it without pulling schemastery.
import { LOCALES } from '../i18n/lines.mjs'

/** The skin a fresh install shows; the host falls back to it when the configured one is gone. */
export const DEFAULT_SKIN = 'deepseek-chan'

/** Every field here is part of the public settings schema. */
export const DEFAULT_PREFS = Object.freeze({
  size: 132,
  opacity: 1,
  reducedMotion: false,
  hover: true,
  randomActs: true,
  meal: true,
  wallet: true,
  wander: true,
  locale: 'en',
  skin: DEFAULT_SKIN,
})

export const PREFS_LIMITS = Object.freeze({
  size: { min: 88, max: 172 },
  opacity: { min: 0.35, max: 1 },
})

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

/**
 * Coerce anything (profile config, a stored value, a preview patch) into valid prefs.
 * Unknown fields are dropped; invalid ones fall back to the defaults.
 */
export function normalisePrefs(value) {
  const source = value !== null && typeof value === 'object' ? value : {}
  const size = Number(source.size)
  const opacity = Number(source.opacity)
  return {
    size: Number.isFinite(size) ? Math.round(clamp(size, PREFS_LIMITS.size.min, PREFS_LIMITS.size.max)) : DEFAULT_PREFS.size,
    opacity: Number.isFinite(opacity) ? clamp(opacity, PREFS_LIMITS.opacity.min, PREFS_LIMITS.opacity.max) : DEFAULT_PREFS.opacity,
    reducedMotion: typeof source.reducedMotion === 'boolean' ? source.reducedMotion : DEFAULT_PREFS.reducedMotion,
    hover: typeof source.hover === 'boolean' ? source.hover : DEFAULT_PREFS.hover,
    randomActs: typeof source.randomActs === 'boolean' ? source.randomActs : DEFAULT_PREFS.randomActs,
    meal: typeof source.meal === 'boolean' ? source.meal : DEFAULT_PREFS.meal,
    wallet: typeof source.wallet === 'boolean' ? source.wallet : DEFAULT_PREFS.wallet,
    wander: typeof source.wander === 'boolean' ? source.wander : DEFAULT_PREFS.wander,
    locale: LOCALES.includes(source.locale) ? source.locale : DEFAULT_PREFS.locale,
    skin: typeof source.skin === 'string' && source.skin !== '' ? source.skin : DEFAULT_PREFS.skin,
  }
}

/**
 * Unwrap one value: hosted config fields marked `.volatile()` arrive as live references
 * (`{ get() }`) that the host updates in place without remounting the plugin.
 */
function unwrap(value) {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)
    && typeof value.get === 'function' && Object.keys(value).length === 1) {
    return unwrap(value.get())
  }
  return value
}

/** Read the plugin config as plain, validated preferences (volatile-aware). */
export function readPrefs(config) {
  const source = config !== null && typeof config === 'object' ? config : {}
  const plain = {}
  for (const key of Object.keys(DEFAULT_PREFS)) {
    plain[key] = unwrap(source[key])
  }
  return normalisePrefs(plain)
}

/** The fields that affect behaviour, for change detection. */
export function samePrefs(a, b) {
  if (a === null || b === null || a === undefined || b === undefined) return false
  return a.size === b.size
    && a.opacity === b.opacity
    && a.reducedMotion === b.reducedMotion
    && a.hover === b.hover
    && a.randomActs === b.randomActs
    && a.meal === b.meal
    && a.wallet === b.wallet
    && a.wander === b.wander
    && a.locale === b.locale
    && a.skin === b.skin
}
