// The connection to the host: SSE with a polling fallback, and the one-shot fetch that seeds
// the state. It moves bytes and reports the connection state; what a snapshot means is decided
// by lib/protocol/contract.mjs.
//
// Used by both pages (the in-page overlay and a desktop shell window). It never throws at the
// caller: a missing host just means "no updates".
import { API_PREFIX, normaliseSnapshot, sameSnapshot } from '../protocol/contract.mjs'

/**
 * @param options.api endpoint prefix
 * @param options.surface 'desktop' tells the host that a shell window is drawing the pet
 * @param options.onSnapshot `(snapshot, changed)` — called for every update
 * @param options.onNavigate `(message)` — a navigation command from the host
 * @param options.onConnection `(state)` — 'live' | 'unknown', only on change
 * @param options.onError `(error)` — optional; transport stays alive either way
 * @param options.pollMs polling interval used when SSE is unavailable
 * @param options.fetchImpl / options.EventSourceImpl injectable for tests
 * @returns `{ start(), stop(), snapshot(), connection() }`
 */
export function createTransport(options = {}) {
  const api = options.api ?? API_PREFIX
  const pollMs = options.pollMs ?? 4000
  const doFetch = options.fetchImpl ?? ((...args) => globalThis.fetch(...args))
  const EventSourceImpl = options.EventSourceImpl ?? globalThis.EventSource
  const surface = typeof options.surface === 'string' && options.surface !== '' ? options.surface : ''
  const onSnapshot = options.onSnapshot ?? (() => {})
  const onNavigate = options.onNavigate ?? (() => {})
  const onConnection = options.onConnection ?? (() => {})
  const onError = options.onError ?? (() => {})

  let stopped = false
  let pollTimer = null
  let source = null
  let current = null
  let connection = null

  function setConnection(next) {
    if (connection === next) return
    connection = next
    onConnection(next)
  }

  function emit(value) {
    // Only an object is a snapshot; anything else on the wire is noise.
    if (value === null || typeof value !== 'object') return
    const next = normaliseSnapshot(value)
    // A late HTTP answer must not roll back a newer SSE state.
    if (current !== null && next.revision > 0 && current.revision > next.revision) return
    const changed = !sameSnapshot(current, next)
    current = next
    onSnapshot(next, changed)
  }

  function refresh() {
    return Promise.resolve()
      .then(() => doFetch(`${api}/state`, { cache: 'no-store', credentials: 'same-origin' }))
      .then((response) => (response && response.ok ? response.json() : null))
      .then((value) => {
        if (value !== null) {
          emit(value)
          setConnection('live')
        }
      })
      .catch((error) => {
        // A failed one-shot fetch does not mean the stream is down.
        const live = source !== null && source.readyState === 1
        if (!live) setConnection('unknown')
        onError(error)
      })
  }

  function startPolling() {
    if (pollTimer !== null || stopped) return
    const tick = () => {
      refresh().then(() => {
        const live = source !== null && source.readyState === 1
        if (!stopped && !live) pollTimer = setTimeout(tick, pollMs)
        else pollTimer = null
      })
    }
    pollTimer = setTimeout(tick, pollMs)
  }

  return {
    /** Open the stream (or the poll loop) and fetch the first snapshot. */
    start() {
      if (stopped) return
      setConnection('unknown')
      refresh()
      if (typeof EventSourceImpl !== 'function') {
        startPolling()
        return
      }
      try {
        const query = surface === '' ? '' : `?surface=${encodeURIComponent(surface)}`
        source = new EventSourceImpl(`${api}/events${query}`)
        if (typeof source.addEventListener === 'function') {
          source.addEventListener('snapshot', (event) => {
            try { emit(JSON.parse(event.data)) } catch (error) { onError(error) }
          })
          source.addEventListener('navigate', (event) => {
            try { onNavigate(JSON.parse(event.data)) } catch (error) { onError(error) }
          })
        }
        source.onopen = () => {
          setConnection('live')
          if (pollTimer !== null) clearTimeout(pollTimer)
          pollTimer = null
        }
        source.onerror = () => {
          setConnection('unknown')
          startPolling()
        }
      } catch (error) {
        source = null
        onError(error)
        startPolling()
      }
    },
    stop() {
      stopped = true
      if (pollTimer !== null) clearTimeout(pollTimer)
      pollTimer = null
      if (source !== null) {
        try { source.close() } catch {}
        source = null
      }
    },
    snapshot() {
      return current
    },
    connection() {
      return connection
    },
  }
}
