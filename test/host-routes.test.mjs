// The sheet route answers a missing sheet with 404, and a sheet that is on disk but cannot be
// read with 500 and a report. A fault is never hidden behind a quiet 404.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHostRoutes, readErrorStatus } from '../lib/host/host-routes.mjs'

function fixtureSkins(t) {
  const dir = mkdtempSync(join(tmpdir(), 'bffg-routes-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const skin = join(dir, 'fixture')
  mkdirSync(skin)
  writeFileSync(join(skin, 'skin.json'), JSON.stringify({ title: 'Fixture' }))
  return { dir, skin }
}

function skinSheetHandler(skinsDir) {
  const route = createHostRoutes({
    publish: () => ({}),
    broadcastNavigate: () => {},
    isTargetOpen: () => false,
    activeSkin: () => 'fixture',
    skinsDir,
  }).find((item) => item.path === '/big-fat-fish-girl/v1/skin')
  return route.handler
}

function response() {
  return {
    status: 0,
    writeHead(status) { this.status = status },
    end() {},
  }
}

test('a sheet that is not on disk is a 404', (t) => {
  const { dir } = fixtureSkins(t)
  const res = response()
  skinSheetHandler(dir)({ method: 'GET', url: '/big-fat-fish-girl/v1/skin/fixture/spritesheet-idle.png' }, res)
  assert.equal(res.status, 404)
})

test('a sheet that is on disk but cannot be read is a 500, and it is reported', (t) => {
  const { dir, skin } = fixtureSkins(t)
  mkdirSync(join(skin, 'spritesheet.png'))  // a directory where the atlas should be
  const warnings = []
  t.mock.method(console, 'warn', (...args) => warnings.push(args.join(' ')))
  const res = response()
  skinSheetHandler(dir)({ method: 'GET', url: '/big-fat-fish-girl/v1/skin/fixture/spritesheet.png' }, res)
  assert.equal(res.status, 500)
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /cannot be read/)
})

test('only a missing file reads as 404; any other failure is a 500', () => {
  assert.equal(readErrorStatus({ code: 'ENOENT' }), 404)
  assert.equal(readErrorStatus({ code: 'EISDIR' }), 500)
  assert.equal(readErrorStatus(new Error('boom')), 500)
})
