// The transport: how snapshots arrive (one-shot fetch, SSE, polling fallback), stale-answer
// protection and the connection state. What a snapshot means is tested in contract.test.mjs.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTransport } from '../lib/web/transport.mjs'

test('транспорт отдаёт снимок и помечает изменения', async () => {
  const seen = []
  const transport = createTransport({
    fetchImpl: async () => ({ ok: true, json: async () => ({ mood: 'running', activeSessions: 1 }) }),
    EventSourceImpl: null,
    onSnapshot: (snapshot, changed) => seen.push({ snapshot, changed }),
  })
  transport.start()
  await new Promise((resolve) => setTimeout(resolve, 5))
  assert.equal(seen.length, 1)
  assert.equal(seen[0].changed, true)
  assert.equal(seen[0].snapshot.mood, 'running')
  assert.deepEqual(transport.snapshot(), seen[0].snapshot)
  transport.stop()
})

test('SSE-события обновляют снимок, stop закрывает источник', async () => {
  let closed = 0
  let handler = null
  const seen = []
  class FakeEventSource {
    constructor(url) { this.url = url; this.readyState = 1 }
    addEventListener(type, listener) { if (type === 'snapshot') handler = listener }
    close() { closed += 1 }
  }
  const transport = createTransport({
    fetchImpl: async () => ({ ok: true, json: async () => ({ mood: 'idle' }) }),
    EventSourceImpl: FakeEventSource,
    onSnapshot: (snapshot) => seen.push(snapshot.mood),
  })
  transport.start()
  await new Promise((resolve) => setTimeout(resolve, 5))
  handler({ data: JSON.stringify({ mood: 'waiting' }) })
  assert.deepEqual(seen, ['idle', 'waiting'])
  transport.stop()
  assert.equal(closed, 1)
})

test('команда navigate доходит до поверхности', async () => {
  const commands = []
  let handler = null
  class FakeEventSource {
    constructor() { this.readyState = 1 }
    addEventListener(type, listener) { if (type === 'navigate') handler = listener }
    close() {}
  }
  const transport = createTransport({
    fetchImpl: async () => ({ ok: true, json: async () => ({ mood: 'idle' }) }),
    EventSourceImpl: FakeEventSource,
    onNavigate: (message) => commands.push(message),
  })
  transport.start()
  await new Promise((resolve) => setTimeout(resolve, 5))
  handler({ data: JSON.stringify({ targetRef: 's1' }) })
  assert.deepEqual(commands, [{ targetRef: 's1' }])
  transport.stop()
})

test('устаревший HTTP-ответ не откатывает состояние назад', async () => {
  const seen = []
  let handler = null
  let resolveFetch = null
  const first = new Promise((resolve) => { resolveFetch = resolve })
  class FakeEventSource {
    constructor() { this.readyState = 1 }
    addEventListener(type, listener) { if (type === 'snapshot') handler = listener }
    close() {}
  }
  const transport = createTransport({
    fetchImpl: () => first.then(() => ({ ok: true, json: async () => ({ mood: 'idle', revision: 1 }) })),
    EventSourceImpl: FakeEventSource,
    onSnapshot: (snapshot) => seen.push(snapshot.revision),
  })
  transport.start()
  await new Promise((resolve) => setTimeout(resolve, 5))
  handler({ data: JSON.stringify({ mood: 'waiting', revision: 9 }) })
  resolveFetch()
  await new Promise((resolve) => setTimeout(resolve, 10))
  assert.deepEqual(seen, [9], 'ответ с revision 1 проигнорирован после события с revision 9')
  transport.stop()
})

test('состояние связи переключается на live и unknown', async () => {
  const states = []
  class FakeEventSource {
    constructor() { this.readyState = 1; queueMicrotask(() => this.onopen?.()) }
    addEventListener() {}
    close() {}
  }
  const transport = createTransport({
    fetchImpl: async () => { throw new Error('нет хоста') },
    EventSourceImpl: FakeEventSource,
    onConnection: (state) => states.push(state),
  })
  transport.start()
  await new Promise((resolve) => setTimeout(resolve, 5))
  assert.equal(transport.connection(), 'live')
  transport.stop()
  assert.deepEqual(states, ['unknown', 'live'])
})

test('битый SSE-пакет не роняет транспорт, ошибка уходит в onError', async () => {
  let handler = null
  const errors = []
  class FakeEventSource {
    constructor() { this.readyState = 1 }
    addEventListener(type, listener) { if (type === 'snapshot') handler = listener }
    close() {}
  }
  const transport = createTransport({
    fetchImpl: async () => { throw new Error('нет хоста') },
    EventSourceImpl: FakeEventSource,
    onError: (error) => errors.push(error),
    onSnapshot: () => { throw new Error('сюда не должно дойти') },
  })
  transport.start()
  await new Promise((resolve) => setTimeout(resolve, 5))
  handler({ data: '{не json' })
  assert.equal(errors.length >= 1, true, 'ошибка должна быть видна, а не проглочена')
  transport.stop()
})
