import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveEsbuildModule } from '../scripts/esbuild-api.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const esbuildModule = resolveEsbuildModule(root, {})

function makeFixture({ sources = false } = {}) {
  const fixture = mkdtempSync(join(tmpdir(), 'bffg build fixture with spaces-'))
  mkdirSync(join(fixture, 'scripts'), { recursive: true })
  mkdirSync(join(fixture, 'node_modules', '.bin'), { recursive: true })
  cpSync(join(root, 'package.json'), join(fixture, 'package.json'))
  for (const file of ['build-client.mjs', 'build-desktop.mjs', 'esbuild-api.mjs']) {
    cpSync(join(root, 'scripts', file), join(fixture, 'scripts', file))
  }

  if (sources) {
    cpSync(join(root, 'lib'), join(fixture, 'lib'), { recursive: true })
    mkdirSync(join(fixture, 'desktop'), { recursive: true })
    for (const file of ['pet-desktop.mjs', 'pet-drag.mjs']) {
      cpSync(join(root, 'desktop', file), join(fixture, 'desktop', file))
    }
  }

  const override = join(fixture, 'custom esbuild api.cjs')
  writeFileSync(override, `module.exports = require(${JSON.stringify(esbuildModule)})\n`)
  // These would fail if either build script tried to execute an npm .bin shim.
  writeFileSync(join(fixture, 'node_modules', '.bin', 'esbuild'), 'this shim must not be executed\n')
  writeFileSync(join(fixture, 'node_modules', '.bin', 'esbuild.cmd'), '@echo off\r\nexit /b 97\r\n')
  const env = { ...process.env, DSH_PLUGIN_ESBUILD: override }
  const run = (script, ...args) => spawnSync(process.execPath, [join(fixture, 'scripts', script), ...args], {
    cwd: fixture,
    env,
    encoding: 'utf8',
  })
  return { fixture, override, run }
}

test('esbuild resolves to its JS API module, not the platform .bin shim', () => {
  assert.equal(esbuildModule, createRequire(import.meta.url).resolve('esbuild'))
  assert.match(esbuildModule, /[\\/]esbuild[\\/]lib[\\/]main\.js$/)
  assert.ok(!esbuildModule.includes(`${join('node_modules', '.bin')}`))
})

test('both bundles build and check correctly from paths with spaces without writing during --check', () => {
  const { fixture, override, run } = makeFixture({ sources: true })
  try {
    assert.ok(fixture.includes(' '), 'fixture root includes spaces')
    assert.ok(override.includes(' '), 'override module path includes spaces')
    for (const [script, target] of [
      ['build-client.mjs', 'lib/client.js'],
      ['build-desktop.mjs', 'desktop/pet.html'],
    ]) {
      const build = run(script)
      assert.equal(build.status, 0, build.stderr)
      assert.equal(readFileSync(join(fixture, target), 'utf8'), readFileSync(join(root, target), 'utf8'))
    }

    const client = join(fixture, 'lib/client.js')
    const desktop = join(fixture, 'desktop/pet.html')
    const clientBeforeCheck = readFileSync(client, 'utf8')
    const desktopBeforeCheck = readFileSync(desktop, 'utf8')
    const libEntriesBeforeCheck = readdirSync(join(fixture, 'lib')).sort()
    const desktopEntriesBeforeCheck = readdirSync(join(fixture, 'desktop')).sort()
    assert.equal(existsSync(join(fixture, 'lib', '.client-build.tmp.js')), false)

    for (const script of ['build-client.mjs', 'build-desktop.mjs']) {
      const check = run(script, '--check')
      assert.equal(check.status, 0, check.stderr)
    }
    assert.equal(readFileSync(client, 'utf8'), clientBeforeCheck)
    assert.equal(readFileSync(desktop, 'utf8'), desktopBeforeCheck)
    assert.deepEqual(readdirSync(join(fixture, 'lib')).sort(), libEntriesBeforeCheck)
    assert.deepEqual(readdirSync(join(fixture, 'desktop')).sort(), desktopEntriesBeforeCheck)

    for (const [script, target, staleMessage] of [
      ['build-client.mjs', client, 'lib/client.js is stale'],
      ['build-desktop.mjs', desktop, 'desktop/pet.html is stale'],
    ]) {
      const stale = `${readFileSync(target, 'utf8')}\n<!-- stale fixture output -->\n`
      writeFileSync(target, stale)
      const check = run(script, '--check')
      assert.equal(check.status, 1)
      assert.ok(check.stderr.includes(staleMessage), check.stderr)
      assert.equal(readFileSync(target, 'utf8'), stale, '--check leaves stale output untouched')
    }
  } finally {
    rmSync(fixture, { recursive: true, force: true })
  }
})

test('both build scripts report esbuild native spawn errors instead of masking the cause', () => {
  const { fixture, override, run } = makeFixture()
  try {
    writeFileSync(override, [
      'module.exports = {',
      '  async build() {',
      "    const error = new Error('spawn esbuild ENOENT: native executable unavailable')",
      "    error.code = 'ENOENT'",
      '    throw error',
      '  },',
      '}\n',
    ].join('\n'))

    for (const script of ['build-client.mjs', 'build-desktop.mjs']) {
      const result = run(script, '--check')
      assert.equal(result.status, 1)
      assert.match(result.stderr, /spawn esbuild ENOENT: native executable unavailable/)
      assert.match(result.stderr, /esbuild failed while building/)
    }
  } finally {
    rmSync(fixture, { recursive: true, force: true })
  }
})
