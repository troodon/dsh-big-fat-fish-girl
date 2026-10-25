// Diagnostics: a failure is reported with its scope and message, and only once per scope, so a
// path that fails every frame cannot flood the console.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { reportOnce, resetReports } from '../lib/diagnostics.mjs'

test('a failure is reported once per scope, with its message', () => {
  resetReports()
  const warnings = []
  const sink = { warn: (...args) => warnings.push(args.join(' ')) }
  reportOnce('pointer capture refused', new Error('no capture'), sink)
  reportOnce('pointer capture refused', new Error('again'), sink)
  reportOnce('navigation failed', 'plain text', sink)
  assert.deepEqual(warnings, [
    'big-fat-fish-girl: pointer capture refused: no capture',
    'big-fat-fish-girl: navigation failed: plain text',
  ])
  resetReports()
})
