// The local playground is a tool contributors will trust; these tests keep it honest
// against the contract the real host serves.
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { server, state } from '../preview/server.mjs'
import { DEFAULT_MANIFEST } from '../lib/animation/manifest.mjs'
import { SHEET_ASSET_REVISIONS } from '../lib/animation/sheet-revisions.mjs'
import { DEFAULT_SKIN } from '../lib/settings/prefs.mjs'

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`
after(() => server.close())

test('песочница отдаёт манифест, состояние и страницу', async () => {
  const manifest = await (await fetch(`${base}/big-fat-fish-girl/v1/manifest`)).json()
  assert.equal(manifest.animations.length, DEFAULT_MANIFEST.animations.length, 'манифест тот же, что у плагина')
  assert.deepEqual(Object.keys(manifest.sheets), ['base', 'idle', 'work', 'food', 'story'])
  assert.equal(
    manifest.sheets.base.url,
    `/big-fat-fish-girl/v1/skin/${DEFAULT_SKIN}/spritesheet.png?v=${SHEET_ASSET_REVISIONS[DEFAULT_SKIN]['spritesheet.png']}`,
    'манифест несёт скин и контентный хэш PNG для сброса старого кэша',
  )
  assert.ok(manifest.scenes.edit, 'сцены сегментов на месте')

  const skins = await (await fetch(`${base}/big-fat-fish-girl/v1/skins`)).json()
  assert.deepEqual(skins.map((skin) => skin.id), ['deepseek-chan'])
  assert.equal(typeof skins[0].title, 'string')

  const snapshot = await (await fetch(`${base}/big-fat-fish-girl/v1/state`)).json()
  assert.equal(snapshot.apiVersion, 3)
  assert.deepEqual(snapshot.team, { active: 0, waiting: 0, completed: 0, errors: 0, coordinating: false })
  assert.equal(snapshot.toolError, null)
  assert.ok('tool' in snapshot, 'поле инструмента на месте')
  assert.ok('navigation' in snapshot, 'цель клика на месте')
  assert.equal(snapshot.prefs.skin, DEFAULT_SKIN, 'скин приезжает в настройках')

  const page = await fetch(`${base}/`)
  assert.match(page.headers.get('content-type'), /text\/html/)
  assert.ok((await page.text()).includes('__ModuleLoader__'), 'страница монтирует настоящий бандл')
})

test('листы идут по белому списку, обход каталога закрыт', async () => {
  for (const name of ['spritesheet.png', 'spritesheet-idle.png', 'spritesheet-work.png', 'spritesheet-food.png', 'spritesheet-story.png']) {
    const response = await fetch(`${base}/big-fat-fish-girl/v1/skin/deepseek-chan/${name}`)
    assert.equal(response.status, 200, `${name} должен отдаваться`)
    const bytes = new Uint8Array(await response.arrayBuffer())
    assert.deepEqual([...bytes.slice(0, 4)], [0x89, 0x50, 0x4e, 0x47], `${name} — настоящий PNG`)
  }
  const legacy = await fetch(`${base}/big-fat-fish-girl/v1/sheet/spritesheet.png`)
  assert.equal(legacy.status, 200, 'старый /sheet резолвится в активный скин')
  for (const attempt of [
    '/big-fat-fish-girl/v1/sheet/../package.json',
    '/big-fat-fish-girl/v1/sheet/%2e%2e/package.json',
    '/big-fat-fish-girl/v1/sheet/lib/index.mjs',
    '/big-fat-fish-girl/v1/sheet/',
    '/big-fat-fish-girl/v1/skin/nope/spritesheet.png',
    '/big-fat-fish-girl/v1/skin/deepseek-chan/../skin.json',
    '/big-fat-fish-girl/v1/skin/deepseek-chan/',
  ]) {
    const response = await fetch(`${base}${attempt}`)
    assert.equal(response.status, 404, `не должно отдаваться: ${attempt}`)
  }
})

test('пульт меняет состояние и рассылает его в поток', async () => {
  // SSE: первый кадр приходит сразу
  const stream = await fetch(`${base}/big-fat-fish-girl/v1/events`)
  const reader = stream.body.getReader()
  const first = new TextDecoder().decode((await reader.read()).value)
  assert.ok(first.includes('event: snapshot'), 'поток начинается со снимка')

  const response = await fetch(`${base}/big-fat-fish-girl/v1/preview/state`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mood: 'waiting' }),
  })
  const patched = await response.json()
  assert.equal(patched.mood, 'waiting')
  assert.equal(patched.mood, 'waiting')

  const tool = await (await fetch(`${base}/big-fat-fish-girl/v1/preview/state`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tool: { phase: 'browsing' } }),
  })).json()
  assert.equal(tool.tool.phase, 'browsing')
  assert.equal(tool.tool.open, true, 'фаза живёт, пока вызов открыт')
  assert.equal(tool.tool.seq, 1, 'счётчик вызовов растёт')
  assert.equal(state.tool.phase, 'browsing')

  const team = await (await fetch(`${base}/big-fat-fish-girl/v1/preview/state`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ team: { active: 3, coordinating: true } }),
  })).json()
  assert.equal(team.team.active, 3)
  assert.equal(team.team.coordinating, true)
  const partialTeam = await (await fetch(`${base}/big-fat-fish-girl/v1/preview/state`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ team: { active: 2 } }),
  })).json()
  assert.equal(partialTeam.team.coordinating, true, 'partial helper updates preserve coordination state')

  // мусор в теле не ломает пульт
  const junk = await (await fetch(`${base}/big-fat-fish-girl/v1/preview/state`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{не json',
  })).json()
  assert.ok(junk.apiVersion === 3)
  reader.cancel()
})

test('мусор в теле не превращается в состояние', async () => {
  const before = JSON.stringify(state)
  await fetch(`${base}/big-fat-fish-girl/v1/preview/state`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mood: 42, tool: 'нет' }),
  })
  assert.equal(JSON.stringify(state), before, 'непонятные поля игнорируются')
  assert.equal(state.apiVersion, 3)
})
