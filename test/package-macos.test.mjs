import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

import { packageMacOSApp } from '../scripts/package-macos.mjs'

const appName = 'Big Fat Fish Girl Shell.app'
const executableName = 'big-fat-fish-girl-shell'
const packageVersion = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version

test('packages an isolated app copy, verifies it after extraction, and writes the named SHA-256 checksum', async () => {
  const fixture = makeFixture()
  try {
    const { run, calls } = fakeMacCommands()
    const output = join(fixture.root, 'release')
    const result = await packageMacOSApp(fixture.app, output, {
      platform: 'darwin', arch: 'x64', run,
    })

    const expectedName = `big-fat-fish-girl-shell-${packageVersion}-macos-x64.zip`
    assert.equal(basename(result.archivePath), expectedName)
    assert.equal(basename(result.checksumPath), `${expectedName}.sha256`)
    assert.deepEqual(readdirSync(output).sort(), [expectedName, `${expectedName}.sha256`])
    const archive = readFileSync(result.archivePath)
    const digest = createHash('sha256').update(archive).digest('hex')
    assert.equal(readFileSync(result.checksumPath, 'utf8'), `${digest}  ${expectedName}\n`)
    assert.equal(readFileSync(join(fixture.app, 'Contents', 'MacOS', executableName), 'utf8'), 'fixture executable')

    const signing = calls.find(([command, args]) => command === 'codesign' && args[0] === '--force')
    assert.deepEqual(signing[1].slice(0, 5), ['--force', '--deep', '--sign', '-', '--timestamp=none'])
    assert.notEqual(signing[1].at(-1), fixture.app, 'the original app must never be signed')
    assert.equal(calls.filter(([command, args]) => command === 'codesign' && args[0] === '--verify').length, 2)
    assert.equal(calls.filter(([command]) => command === 'lipo').length, 2)
    assert.ok(calls.some(([command, args]) => command === 'ditto' && args.includes('--keepParent')))
    assert.ok(calls.some(([command, args]) => command === 'ditto' && args[0] === '-x'))
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test('rejects an executable without the host release architecture before staging', async () => {
  const fixture = makeFixture()
  try {
    const output = join(fixture.root, 'release')
    const { run } = fakeMacCommands({ architectures: 'arm64' })
    await assert.rejects(
      packageMacOSApp(fixture.app, output, { platform: 'darwin', arch: 'x64', packageVersion, run }),
      /does not contain required x86_64 architecture/,
    )
    assert.equal(existsSync(output), false)
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test('rejects a bundle identifier that is not the Tauri shell identifier', async () => {
  const fixture = makeFixture()
  try {
    const output = join(fixture.root, 'release')
    const { run, calls } = fakeMacCommands({ identifier: 'dev.example.other' })
    await assert.rejects(
      packageMacOSApp(fixture.app, output, { platform: 'darwin', arch: 'x64', packageVersion, run }),
      (error) => error.message === 'unexpected bundle identifier: dev.example.other',
    )
    assert.equal(calls.some(([command]) => command === 'lipo'), false)
    assert.equal(existsSync(output), false)
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test('rejects an app version that differs from package.json before staging', async () => {
  const fixture = makeFixture()
  try {
    const output = join(fixture.root, 'release')
    const { run, calls } = fakeMacCommands({ version: '9.9.9' })
    await assert.rejects(
      packageMacOSApp(fixture.app, output, { platform: 'darwin', arch: 'x64', packageVersion, run }),
      (error) => error.message === `app version 9.9.9 does not match package.json version ${packageVersion}`,
    )
    assert.equal(calls.some(([command]) => command === 'lipo'), false)
    assert.equal(existsSync(output), false)
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test('rejects non-macOS hosts and unsupported architectures before touching the app', async () => {
  await assert.rejects(packageMacOSApp('/missing.app', '/unused', {
    platform: 'linux', arch: 'arm64', packageVersion,
  }), /must run on macOS/)
  await assert.rejects(packageMacOSApp('/missing.app', '/unused', {
    platform: 'darwin', arch: 'ia32', packageVersion,
  }), /unsupported macOS architecture: ia32/)
})

test('propagates signing errors and removes staging files', async () => {
  const fixture = makeFixture()
  try {
    const output = join(fixture.root, 'release')
    const failure = new Error('simulated codesign failure')
    const commands = fakeMacCommands()
    const run = (command, args) => {
      if (command === 'codesign' && args[0] === '--force') throw failure
      return commands.run(command, args)
    }
    await assert.rejects(
      packageMacOSApp(fixture.app, output, { platform: 'darwin', arch: 'x64', packageVersion, run }),
      (error) => error === failure,
    )
    assert.deepEqual(readdirSync(output), [])
    assert.equal(readFileSync(join(fixture.app, 'Contents', 'MacOS', executableName), 'utf8'), 'fixture executable')
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test('cleans the staged app after extracted-archive signature verification fails', async () => {
  const fixture = makeFixture()
  try {
    const output = join(fixture.root, 'release')
    const failure = new Error('extracted app signature verification failed')
    const commands = fakeMacCommands()
    let verificationCount = 0
    const run = (command, args) => {
      if (command === 'codesign' && args[0] === '--verify' && ++verificationCount === 2) throw failure
      return commands.run(command, args)
    }
    await assert.rejects(
      packageMacOSApp(fixture.app, output, { platform: 'darwin', arch: 'x64', packageVersion, run }),
      (error) => error === failure,
    )
    const archiveName = `big-fat-fish-girl-shell-${packageVersion}-macos-x64.zip`
    assert.deepEqual(readdirSync(output), [])
    assert.equal(existsSync(join(output, archiveName)), false)
    assert.equal(existsSync(join(output, `${archiveName}.sha256`)), false)
    assert.equal(readFileSync(join(fixture.app, 'Contents', 'MacOS', executableName), 'utf8'), 'fixture executable')
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test('refuses existing archive and checksum files without modifying them', async () => {
  const fixture = makeFixture()
  try {
    const output = join(fixture.root, 'release')
    mkdirSync(output)
    const archiveName = `big-fat-fish-girl-shell-${packageVersion}-macos-x64.zip`
    const archivePath = join(output, archiveName)
    const checksumPath = `${archivePath}.sha256`
    const { run } = fakeMacCommands()

    writeFileSync(archivePath, 'keep existing archive')
    await assert.rejects(
      packageMacOSApp(fixture.app, output, { platform: 'darwin', arch: 'x64', packageVersion, run }),
      /release archive or checksum already exists/,
    )
    assert.equal(readFileSync(archivePath, 'utf8'), 'keep existing archive')
    assert.equal(existsSync(checksumPath), false)

    rmSync(archivePath)
    writeFileSync(checksumPath, 'keep existing checksum')
    await assert.rejects(
      packageMacOSApp(fixture.app, output, { platform: 'darwin', arch: 'x64', packageVersion, run }),
      /release archive or checksum already exists/,
    )
    assert.equal(readFileSync(checksumPath, 'utf8'), 'keep existing checksum')
    assert.deepEqual(readdirSync(output), [`${archiveName}.sha256`])
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test('rejects a signature that advertises a Developer ID authority and cleans staging', async () => {
  const fixture = makeFixture()
  try {
    const output = join(fixture.root, 'release')
    const { run } = fakeMacCommands({
      signatureDetails: 'Signature=adhoc\nTeamIdentifier=not set\nAuthority=Developer ID Application: Example\n',
    })
    await assert.rejects(
      packageMacOSApp(fixture.app, output, { platform: 'darwin', arch: 'x64', packageVersion, run }),
      /signature is not ad-hoc signed/,
    )
    assert.deepEqual(readdirSync(output), [])
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), 'bffg-package-macos-test-'))
  const app = join(root, appName)
  const contents = join(app, 'Contents')
  const executable = join(contents, 'MacOS', executableName)
  mkdirSync(join(contents, 'MacOS'), { recursive: true })
  writeFileSync(join(contents, 'Info.plist'), 'fixture plist')
  writeFileSync(executable, 'fixture executable')
  chmodSync(executable, 0o755)
  return { root, app }
}

function fakeMacCommands({
  identifier = 'dev.bffg.shell',
  version = packageVersion,
  architectures = 'x86_64',
  signatureDetails = 'Signature=adhoc\nTeamIdentifier=not set\n',
} = {}) {
  const calls = []
  let archivedApp = null
  const run = (command, args) => {
    calls.push([command, args])
    if (command === '/usr/libexec/PlistBuddy') {
      return args[1] === 'Print :CFBundleIdentifier' ? identifier : version
    }
    if (command === 'lipo') return architectures
    if (command === 'codesign') return args[0] === '-d' ? signatureDetails : ''
    if (command === 'ditto' && args[0] === '-c') {
      archivedApp = args[4]
      writeFileSync(args[5], 'fixture archive bytes')
      return ''
    }
    if (command === 'ditto' && args[0] === '-x') {
      const extractionDirectory = args.at(-1)
      mkdirSync(extractionDirectory, { recursive: true })
      cpSync(archivedApp, join(extractionDirectory, basename(archivedApp)), { recursive: true })
      return ''
    }
    assert.fail(`unexpected command: ${command} ${args.join(' ')}`)
  }
  return { calls, run }
}
