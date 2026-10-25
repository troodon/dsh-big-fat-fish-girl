import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_MANIFEST } from '../lib/animation/manifest-defaults.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const generatedPaths = [
  'lib/animation/sheet-revisions.mjs',
  'lib/animation/skin-profiles.mjs',
]

test('generated skin data checks out as LF even with core.autocrlf enabled', () => {
  const checkout = mkdtempSync(join(tmpdir(), 'skin-data-checkout-'))
  try {
    execFileSync('git', [
      '-c', 'core.autocrlf=true',
      'checkout-index',
      `--prefix=${checkout}${sep}`,
      '--',
      ...generatedPaths,
    ], { cwd: root })

    for (const path of generatedPaths) {
      const checkedOut = readFileSync(join(checkout, path), 'utf8')
      assert.ok(checkedOut.endsWith('\n'), `${path} ends with LF`)
      assert.ok(!checkedOut.includes('\r'), `${path} has no CRLF characters`)
    }
  } finally {
    rmSync(checkout, { recursive: true, force: true })
  }
})

test('skin data --check accepts generated output and still reports stale files', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'skin-data-fixture-'))
  const script = join(fixture, 'scripts', 'build-skin-data.mjs')
  const animation = join(fixture, 'lib', 'animation')
  const skin = join(fixture, 'lib', 'skins', 'deepseek-chan')
  mkdirSync(dirname(script), { recursive: true })
  mkdirSync(animation, { recursive: true })
  mkdirSync(skin, { recursive: true })

  try {
    copyFileSync(join(root, 'scripts', 'build-skin-data.mjs'), script)
    copyFileSync(join(root, 'lib', 'animation', 'manifest-defaults.mjs'), join(animation, 'manifest-defaults.mjs'))
    for (const sheet of Object.values(DEFAULT_MANIFEST.sheets)) {
      writeFileSync(join(skin, sheet.file), `fixture:${sheet.file}`)
    }
    const head = Object.fromEntries(Object.entries(DEFAULT_MANIFEST.sheets)
      .map(([id, sheet]) => [id, Array(sheet.rows).fill(0)]))
    writeFileSync(join(skin, 'skin.json'), JSON.stringify({ head }))

    const run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' })
    const build = run()
    assert.equal(build.status, 0, build.stderr)
    const freshCheck = run('--check')
    assert.equal(freshCheck.status, 0, freshCheck.stderr)

    for (const path of generatedPaths) {
      const output = join(fixture, path)
      writeFileSync(output, `${readFileSync(output, 'utf8')}// stale change\n`)
      const staleCheck = run('--check')
      assert.equal(staleCheck.status, 1)
      assert.ok(staleCheck.stderr.includes(relative(fixture, output)), staleCheck.stderr)
      const otherPath = generatedPaths.find((candidate) => candidate !== path)
      assert.ok(!staleCheck.stderr.includes(otherPath), staleCheck.stderr)
      assert.ok(readFileSync(output, 'utf8').endsWith('// stale change\n'), '--check leaves stale output untouched')

      const rebuild = run()
      assert.equal(rebuild.status, 0, rebuild.stderr)
      const repairedCheck = run('--check')
      assert.equal(repairedCheck.status, 0, repairedCheck.stderr)
    }
  } finally {
    rmSync(fixture, { recursive: true, force: true })
  }
})
