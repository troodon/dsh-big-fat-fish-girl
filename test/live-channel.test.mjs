// The live channel: one event stream per client, a heartbeat for each, and the shell presence
// that a desktop client brings with it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createLiveChannel, isDesktopSurface } from '../lib/host/live-channel.mjs'
import { createShellPresence } from '../lib/host/shell-presence.mjs'

// A response that records what it was sent and can be made to fail, like a closed socket.
function fakeResponse() {
  const res = {
    status: 0,
    writes: [],
    attempts: 0,
    broken: false,
    ended: false,
    listeners: {},
    writeHead(status) { res.status = status },
    flushHeaders() {},
    write(chunk) {
      res.attempts += 1
      if (res.broken) throw new Error('socket closed')
      res.writes.push(chunk)
    },
    end() { res.ended = true },
    once(event, listener) { res.listeners[event] = listener },
  }
  return res
}

const get = (url) => ({ method: 'GET', url })

test('only the desktop surface is recognised from the query string', () => {
  assert.equal(isDesktopSurface('/big-fat-fish-girl/v1/events?surface=desktop'), true)
  assert.equal(isDesktopSurface('/big-fat-fish-girl/v1/events?x=1&surface=desktop#top'), true)
  assert.equal(isDesktopSurface('/big-fat-fish-girl/v1/events?surface=desktopX'), false)
  assert.equal(isDesktopSurface('/big-fat-fish-girl/v1/events'), false)
  assert.equal(isDesktopSurface(undefined), false)
})

test('a new client gets the retry hint and the current snapshot; other methods are refused', (t) => {
  const channel = createLiveChannel({ snapshot: () => ({ mood: 'idle' }), presence: createShellPresence() })
  t.after(() => channel.closeAll())
  const refused = fakeResponse()
  channel.connect({ method: 'POST', url: '/events' }, refused)
  assert.equal(refused.status, 405)

  const res = fakeResponse()
  channel.connect(get('/events'), res)
  assert.equal(res.status, 200)
  assert.equal(res.writes[0], 'retry: 3000\n\n')
  assert.equal(res.writes[1], 'event: snapshot\ndata: {"mood":"idle"}\n\n')
})

test('a desktop client makes the shell present, and every client hears about it at once', (t) => {
  let now = 0
  const presence = createShellPresence({ now: () => now })
  const channel = createLiveChannel({ snapshot: () => ({ shellActive: presence.publish() }), presence })
  t.after(() => channel.closeAll())
  const overlay = fakeResponse()
  channel.connect(get('/events'), overlay)
  const desktop = fakeResponse()
  channel.connect(get('/events?surface=desktop'), desktop)
  assert.equal(presence.active(), true)
  assert.match(overlay.writes.at(-1), /"shellActive":true/, 'the in-page overlay learns of the shell at once')

  desktop.listeners.close()
  now = 60000
  assert.equal(presence.active(), false, 'after the grace period the overlay comes back')
})

test('a client that stops accepting writes is dropped together with its heartbeat', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] })
  const channel = createLiveChannel({ snapshot: () => ({}), presence: createShellPresence() })
  t.after(() => channel.closeAll())
  const res = fakeResponse()
  channel.connect(get('/events'), res)
  res.broken = true
  channel.sendSnapshot()
  const attempts = res.attempts
  t.mock.timers.tick(60000)
  assert.equal(res.attempts, attempts, 'no heartbeat is tried once the client is gone')
})
