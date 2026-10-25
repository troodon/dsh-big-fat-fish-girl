// Failures the pet can survive are still reported, never swallowed. Each cause is reported
// once: a broken path that runs every frame must not flood the console, and the first
// report is enough to find it. Pure apart from the console it writes to.
const reported = new Set()

/**
 * Report `error` under `scope` the first time that scope fails.
 * @param scope what failed, in words, e.g. 'pointer capture refused'
 * @param error the thrown value
 * @param sink where the warning goes (tests pass their own)
 */
export function reportOnce(scope, error, sink = console) {
  if (reported.has(scope)) return
  reported.add(scope)
  sink.warn(`big-fat-fish-girl: ${scope}:`, error?.message ?? error)
}

/** Forget every report, so a test can start from a clean slate. */
export function resetReports() {
  reported.clear()
}
