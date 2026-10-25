// The desktop shell's presence: the in-page overlay steps aside while a shell is connected,
// and keeps stepping aside for a grace period after the shell's last client leaves.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createShellPresence, SHELL_GRACE_MS } from '../lib/host/shell-presence.mjs'

test('a connected desktop client keeps the overlay out of the way', () => {
  const presence = createShellPresence({ now: () => 0 })
  assert.equal(presence.active(), false, 'no shell, no presence')
  presence.open()
  assert.equal(presence.active(), true)
})

test('a disconnected shell stays present for the grace period, then is gone', () => {
  let now = 1000
  const presence = createShellPresence({ now: () => now })
  presence.open()
  now = 2000
  presence.close()
  now = 2000 + SHELL_GRACE_MS - 1
  assert.equal(presence.active(), true, 'a reconnect inside the grace window does not flicker the pet')
  now = 2000 + SHELL_GRACE_MS
  assert.equal(presence.active(), false)
})

test('a shell this plugin launched counts as present from the start', () => {
  let now = 0
  const presence = createShellPresence({ shellStarted: true, now: () => now })
  assert.equal(presence.active(), true)
  now = SHELL_GRACE_MS
  assert.equal(presence.active(), false)
})

test('the shell stays present until its last client leaves; extra closes never go negative', () => {
  const presence = createShellPresence({ now: () => 0, graceMs: 0 })
  presence.open()
  presence.open()
  presence.close()
  assert.equal(presence.active(), true, 'one client is still connected')
  presence.close()
  presence.close()
  assert.equal(presence.active(), false)
})

test('changed() reports a flip since the last published snapshot', () => {
  const presence = createShellPresence({ now: () => 0 })
  assert.equal(presence.changed(), false, 'nothing published yet')
  assert.equal(presence.publish(), false)
  presence.open()
  assert.equal(presence.changed(), true)
  assert.equal(presence.publish(), true)
  assert.equal(presence.changed(), false)
})
