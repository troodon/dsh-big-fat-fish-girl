// Installed skins: a folder that cannot be read is skipped and reported, never hidden, and the
// good skins still load.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listSkins } from '../lib/host/skins.mjs'

test('a broken skin is skipped and reported once; the good ones still load', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'bffg-skins-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  mkdirSync(join(dir, 'good'))
  writeFileSync(join(dir, 'good', 'skin.json'), JSON.stringify({ title: 'Good' }))
  mkdirSync(join(dir, 'broken'))
  writeFileSync(join(dir, 'broken', 'skin.json'), '{ not json')
  const warnings = []
  t.mock.method(console, 'warn', (...args) => warnings.push(args.join(' ')))

  assert.deepEqual(listSkins(dir).map((skin) => skin.id), ['good'])
  assert.deepEqual(listSkins(dir).map((skin) => skin.id), ['good'], 'listing again still works')
  assert.equal(warnings.length, 1, 'the same problem is reported once, not on every request')
  assert.match(warnings[0], /"broken" is skipped/)
})

test('a missing skins folder is reported and yields no skins', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'bffg-skins-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const warnings = []
  t.mock.method(console, 'warn', (...args) => warnings.push(args.join(' ')))
  assert.deepEqual(listSkins(join(dir, 'missing')), [])
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /no skins can be read/)
})
