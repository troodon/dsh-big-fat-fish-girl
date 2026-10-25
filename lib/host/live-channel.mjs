// The live channel to the pet's pages: one server-sent-event stream per client, a heartbeat
// that keeps proxies from closing it, and the two messages the host sends — a snapshot and an
// allow-listed navigate command. Clients of the desktop surface also count as shell presence.
const HEARTBEAT_MS = 20000
// Tells the browser how long to wait before it reconnects after the stream drops.
const RETRY_MS = 3000

/** The desktop page says so in its query string; the in-page overlay does not. */
export function isDesktopSurface(url) {
  return typeof url === 'string' && /(?:^|[?&])surface=desktop(?:&|#|$)/.test(url)
}

/**
 * @param options.snapshot `() => snapshot`, exactly as the host publishes it
 * @param options.presence the shell presence tracker (see shell-presence.mjs)
 */
export function createLiveChannel({ snapshot, presence }) {
  // Each client maps to its heartbeat timer, so dropping a client always stops its timer too.
  const clients = new Map()

  function drop(client) {
    clearInterval(clients.get(client))
    clients.delete(client)
  }

  function send(line) {
    for (const client of [...clients.keys()]) {
      try { client.write(line) } catch { drop(client) }
    }
  }

  function snapshotLine() {
    return 'event: snapshot\ndata: ' + JSON.stringify(snapshot()) + '\n\n'
  }

  return {
    /** Every client receives the same snapshot: settings and shell flag as they are now. */
    sendSnapshot() {
      send(snapshotLine())
    },
    /** `targetRef` is an opaque ref; the caller has already checked that it is open. */
    sendNavigate(targetRef) {
      send('event: navigate\ndata: ' + JSON.stringify({ targetRef }) + '\n\n')
    },
    /** Serve one connection to the events route. */
    connect(req, res) {
      if (req.method !== 'GET') {
        res.writeHead(405, { allow: 'GET' })
        return res.end()
      }
      const isDesktop = isDesktopSurface(req.url)
      if (isDesktop) presence.open()
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
        'x-content-type-options': 'nosniff',
      })
      if (typeof res.flushHeaders === 'function') res.flushHeaders()
      res.write(`retry: ${RETRY_MS}\n\n`)
      res.write(snapshotLine())
      clients.set(res, setInterval(() => {
        try { res.write(': heartbeat\n\n') } catch { drop(res) }
      }, HEARTBEAT_MS))
      const close = () => {
        drop(res)
        if (isDesktop) presence.close()
      }
      if (typeof res.once === 'function') res.once('close', close)
      else if (typeof res.on === 'function') res.on('close', close)
      // The in-page overlay needs the shell flag right away, not on the next event.
      if (isDesktop) send(snapshotLine())
    },
    /** Ends every open stream; called when the plugin is disposed. */
    closeAll() {
      for (const [client, heartbeat] of [...clients]) {
        clearInterval(heartbeat)
        try { client.end() } catch {}
      }
      clients.clear()
    },
  }
}
