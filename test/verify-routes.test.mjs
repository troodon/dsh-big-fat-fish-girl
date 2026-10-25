// The playground must answer exactly like the real host, or it teaches contributors the
// wrong contract. This runs the release checker against it.
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { server } from '../preview/server.mjs'
import { verifyRoutes } from '../scripts/verify-routes.mjs'

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`
after(() => server.close())

test('песочница отвечает тому же контракту, что и настоящее приложение', async () => {
  const { ok, checks } = await verifyRoutes(base)
  const failed = checks.filter((check) => !check.ok).map((check) => `${check.label} — ${check.detail}`)
  assert.deepEqual(failed, [], 'песочница разошлась с контрактом плагина')
  assert.equal(ok, true)
  assert.ok(checks.length >= 20, `проверок должно быть достаточно, а их ${checks.length}`)
})

test('проверка контракта падает, если контракт нарушен', async () => {
  // Порт, на котором ничего не слушает: каждая проверка обязана провалиться, а не молчать.
  const broken = await verifyRoutes('http://127.0.0.1:1', { log: () => {} }).catch(() => null)
  assert.equal(broken, null, 'недоступный хост — это исключение, а не «всё хорошо»')
})
