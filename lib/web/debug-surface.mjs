// The debug surface: the smoke tests drive the pet through `globalThis.__BFFG_DEBUG__`, so a
// test opts in by setting `__BFFG_DEBUG_ENABLED__ = true` before the bundle loads. A page
// that does not opt in exposes nothing, so nothing outside the plugin can reach the engine.
/**
 * @param surface the object the tests call into
 * @returns whether the surface was exposed
 */
export function exposeDebugSurface(surface) {
  if (globalThis.__BFFG_DEBUG_ENABLED__ !== true) return false
  globalThis.__BFFG_DEBUG__ = surface
  return true
}
