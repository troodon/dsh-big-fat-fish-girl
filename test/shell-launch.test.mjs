// Process discovery and ownership are tested without Harness; one integration case
// also exercises a real spawn failure.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  desktopPageUrl,
  ensureShell,
  findRunningShell,
  otherShellPid,
  parsePids,
  resolveShellBinary,
  shellBinaryCandidates,
} from '../lib/host/shell-launch.mjs'

test('pgrep: строки разбираются, мусор игнорируется, свой pid исключается', () => {
  assert.deepEqual(parsePids('412\n813\n'), [412, 813])
  assert.deepEqual(parsePids('412 813'), [412, 813])
  assert.deepEqual(parsePids('pgrep: nothing\n'), [])
  assert.deepEqual(parsePids(undefined), [])
  assert.equal(otherShellPid([100, 200], 200), 100)
  assert.equal(otherShellPid([200], 200), null)
  assert.equal(otherShellPid([], 1), null)
})

test('findRunningShell: pgrep no-match is quiet; unexpected errors are reported', () => {
  const reports = []
  const noMatch = Object.assign(new Error('no match'), { status: 1 })
  assert.equal(findRunningShell(() => { throw noMatch }, 'darwin', (error) => reports.push(error)), null)
  assert.deepEqual(reports, [])
  assert.equal(findRunningShell(() => '777\n', 'darwin'), 777)

  const failure = new Error('pgrep unavailable')
  assert.equal(findRunningShell(() => { throw failure }, 'darwin', (error) => reports.push(error)), null)
  assert.deepEqual(reports, [failure])

  let queried = false
  assert.equal(findRunningShell(() => { queried = true; return '' }, 'freebsd'), null)
  assert.equal(queried, false, 'unsupported platforms do not invoke a process query')
})

test('findRunningShell: шаблон ловит бинарник и с аргументами, и без', () => {
  let pattern = null
  findRunningShell((_file, args) => { pattern = args[args.length - 1]; return '' }, 'darwin')
  const re = new RegExp(pattern)
  assert.ok(re.test('/Applications/Big Fat Fish Girl Shell.app/Contents/MacOS/big-fat-fish-girl-shell'))
  assert.ok(re.test('/repo/desktop/tauri/target/debug/big-fat-fish-girl-shell --url http://127.0.0.1:50543/big-fat-fish-girl/v1/desktop'))
  assert.equal(re.test('comments-about-big-fat-fish-girl-shell'), false, 'упоминание в тексте — не процесс')
})

test('macOS candidates use POSIX paths off-host; unsupported platforms stay empty', () => {
  assert.deepEqual(shellBinaryCandidates({ platform: 'linux', pluginRoot: '/repo' }), [])
  const candidates = shellBinaryCandidates({
    platform: 'darwin',
    pluginRoot: '/repo',
    configured: '/custom/Pet.app',
    env: {},
  })
  assert.equal(candidates[0], '/custom/Pet.app/Contents/MacOS/big-fat-fish-girl-shell')
  assert.equal(candidates[1], '/repo/desktop/tauri/target/release/bundle/macos/Big Fat Fish Girl Shell.app/Contents/MacOS/big-fat-fish-girl-shell')
  assert.equal(candidates[2], '/Applications/Big Fat Fish Girl Shell.app/Contents/MacOS/big-fat-fish-girl-shell')

  const raw = shellBinaryCandidates({ platform: 'darwin', pluginRoot: '', configured: '/opt/pet/bffg-shell' })
  assert.equal(raw[0], '/opt/pet/bffg-shell')
})

test('macOS finds a user-level app before a system install without changing settings', () => {
  const options = { platform: 'darwin', env: { HOME: '/Users/Fish Keeper' } }
  const candidates = shellBinaryCandidates(options)
  assert.deepEqual(candidates, [
    '/Users/Fish Keeper/Applications/Big Fat Fish Girl Shell.app/Contents/MacOS/big-fat-fish-girl-shell',
    '/Applications/Big Fat Fish Girl Shell.app/Contents/MacOS/big-fat-fish-girl-shell',
  ])
  assert.equal(resolveShellBinary({ ...options, exists: () => true }), candidates[0])
  assert.equal(resolveShellBinary({ ...options, exists: (path) => path === candidates[1] }), candidates[1])
  assert.deepEqual(shellBinaryCandidates({ platform: 'darwin', env: { HOME: 'relative' } }), [candidates[1]])
})

test('desktopPageUrl: origin веб-сервера становится URL страницы; иначе null', () => {
  assert.equal(
    desktopPageUrl({ getOrigin: () => 'http://127.0.0.1:50543' }),
    'http://127.0.0.1:50543/big-fat-fish-girl/v1/desktop',
  )
  assert.equal(
    desktopPageUrl({ getOrigin: () => 'http://[::1]:3080' }),
    'http://[::1]:3080/big-fat-fish-girl/v1/desktop',
  )
  // Older hosts without getOrigin leave discovery to the shell.
  assert.equal(desktopPageUrl({ register() {} }), null)
  assert.equal(desktopPageUrl(undefined), null)
  // The origin can be unavailable until the server binds its port.
  assert.equal(desktopPageUrl({ getOrigin: () => { throw new Error('not bound') } }), null)
  assert.equal(desktopPageUrl({ getOrigin: () => 'not a url' }), null)
})

test('resolveShellBinary: первый существующий, иначе null', () => {
  const options = { platform: 'darwin', pluginRoot: '/repo', configured: '/gone' }
  const existing = ['/repo/desktop/tauri/target/release/bundle/macos/Big Fat Fish Girl Shell.app/Contents/MacOS/big-fat-fish-girl-shell']
  assert.equal(resolveShellBinary({ ...options, exists: (path) => existing.includes(path) }), existing[0])
  assert.equal(resolveShellBinary({ ...options, exists: () => false }), null)
  assert.equal(resolveShellBinary({ platform: 'linux', exists: () => true }), null)
})

test('ensureShell: выключено, нет бинарника или уже запущена — ничего не делаем', () => {
  let launched = 0
  const launch = () => { launched += 1; return { kill() {} } }

  assert.equal(ensureShell({ autoStart: false, binary: '/x', running: () => null, launch }).started, false)
  assert.equal(ensureShell({ autoStart: true, binary: null, running: () => null, launch }).started, false)
  assert.equal(ensureShell({ autoStart: true, binary: '/x', running: () => 42, launch }).started, false)
  assert.equal(launched, 0)

  // A manually launched shell is not owned by the plugin.
  let killed = 0
  const foreign = ensureShell({ autoStart: true, binary: '/x', running: () => 42, launch: () => ({ kill() { killed += 1 } }) })
  foreign.dispose()
  assert.equal(killed, 0)
})

test('ensureShell: запускает и dispose останавливает ровно свой процесс', () => {
  let killed = 0
  const child = { kill() { killed += 1 } }
  const shell = ensureShell({ autoStart: true, binary: '/x', running: () => null, launch: () => child })
  assert.equal(shell.started, true)
  shell.dispose()
  shell.dispose()
  assert.equal(killed, 1, 'повторный dispose не должен убивать дважды')
})

test('ensureShell: аргументы запуска (--url страницы) доходят до launch', () => {
  const calls = []
  const page = 'http://127.0.0.1:50543/big-fat-fish-girl/v1/desktop'
  const shell = ensureShell({
    autoStart: true,
    binary: '/x',
    args: ['--url', page],
    running: () => null,
    launch: (binary, _onError, args) => { calls.push([binary, args]); return { kill() {} } },
  })
  assert.deepEqual(calls, [['/x', ['--url', page]]])
  shell.dispose()
})

test('ensureShell: ошибка запуска не роняет плагин', () => {
  const shell = ensureShell({
    autoStart: true,
    binary: '/x',
    running: () => null,
    launch: () => { throw new Error('spawn failed') },
  })
  assert.equal(shell.started, false)
  shell.dispose()
})

test('ensureShell: a synchronous launch callback failure is reported once', () => {
  const failure = new Error('launch failed')
  const reports = []
  const shell = ensureShell({
    binary: '/x',
    running: () => null,
    launch: (_binary, onError) => {
      onError(failure)
      return { kill() { assert.fail('a failed launch is not owned') } }
    },
    report: (error) => reports.push(error),
  })
  assert.equal(shell.started, false)
  assert.deepEqual(reports, [failure])
  shell.dispose()
})

test('ensureShell: a launch that fails later is reported and no longer counted as running', () => {
  let fail = null
  const reports = []
  const shell = ensureShell({
    autoStart: true,
    binary: '/x',
    running: () => null,
    launch: (binary, onError) => { fail = onError; return { kill() {} } },
    report: (error) => reports.push(error.message),
  })
  assert.equal(shell.started, true)
  fail(new Error('spawn EACCES'))
  assert.equal(shell.started, false)
  assert.deepEqual(reports, ['spawn EACCES'])
  shell.dispose()
})

test('ensureShell: unexpected exits clear started and report crashes, but zero exit is quiet', () => {
  const reports = []
  const crashedChild = new EventEmitter()
  let kills = 0
  crashedChild.kill = () => { kills += 1 }
  const crashed = ensureShell({
    binary: '/x',
    running: () => null,
    launch: () => crashedChild,
    report: (error) => reports.push(error),
  })
  assert.equal(crashed.started, true)
  crashedChild.emit('exit', 2, null)
  assert.equal(crashed.started, false)
  assert.match(reports[0].message, /exit code 2/)
  crashed.dispose()
  assert.equal(kills, 0, 'an exited child is not killed again')

  const normalChild = new EventEmitter()
  const normal = ensureShell({
    binary: '/x',
    running: () => null,
    launch: () => normalChild,
    report: (error) => reports.push(error),
  })
  normalChild.emit('exit', 0, null)
  assert.equal(normal.started, false)
  assert.equal(reports.length, 1, 'zero exit is quiet (including native duplicate-instance exit)')

  const signaledChild = new EventEmitter()
  const signaled = ensureShell({
    binary: '/x',
    running: () => null,
    launch: () => signaledChild,
    report: (error) => reports.push(error),
  })
  signaledChild.emit('exit', null, 'SIGTERM')
  assert.equal(signaled.started, false)
  assert.match(reports[1].message, /signal SIGTERM/)
})

test('ensureShell: dispose clears ownership before synchronous exit and kills only once', () => {
  const child = new EventEmitter()
  const reports = []
  let kills = 0
  child.kill = () => {
    kills += 1
    child.emit('exit', 1, null)
  }
  const shell = ensureShell({
    binary: '/x',
    running: () => null,
    launch: () => child,
    report: (error) => reports.push(error),
  })
  assert.equal(shell.started, true)
  shell.dispose()
  shell.dispose()
  assert.equal(shell.started, false)
  assert.equal(kills, 1)
  assert.deepEqual(reports, [], 'a synchronous exit caused by dispose is expected')
})

test('ensureShell: kill exceptions are reported', () => {
  const failure = new Error('kill failed')
  const reports = []
  let kills = 0
  const shell = ensureShell({
    binary: '/x',
    running: () => null,
    launch: () => ({ kill() { kills += 1; throw failure } }),
    report: (error) => reports.push(error),
  })
  shell.dispose()
  shell.dispose()
  assert.equal(shell.started, false)
  assert.equal(kills, 1)
  assert.deepEqual(reports, [failure])
})

test('ensureShell: a real spawn of a non-executable file is reported, not fatal', { timeout: 5000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bffg-shell-'))
  let shell = null
  let timer = null
  try {
    const binary = join(dir, 'not-executable')
    writeFileSync(binary, '#!/bin/sh\n', { mode: 0o644 })
    const failure = new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('spawn error event did not arrive')), 3000)
      shell = ensureShell({ autoStart: true, binary, running: () => null, report: resolve })
    })
    const error = await failure
    clearTimeout(timer)
    assert.equal(typeof error.code, 'string')
    assert.notEqual(error.code, '')
    if (process.platform !== 'win32') assert.equal(error.code, 'EACCES')
    assert.equal(shell.started, false)
  } finally {
    clearTimeout(timer)
    shell?.dispose()
    rmSync(dir, { recursive: true, force: true })
  }
})
