import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  ensureShell,
  findRunningShell,
  parseTasklistPids,
  parseTasklistSessionId,
  resolveShellBinary,
  shellBinaryCandidates,
} from '../lib/host/shell-launch.mjs'

const shellImage = 'big-fat-fish-girl-shell.exe'
const tasklistRow = (image, pid, sessionId) => `"${image}","${pid}","Console","${sessionId}","12,345 K"`

test('Windows binary candidates cover configured, development, and per-user installs', () => {
  const localAppData = 'C:\\Users\\fixture\\AppData\\Local'
  const pluginRoot = 'C:\\repo'
  const configured = 'D:\\custom\\big-fat-fish-girl-shell.exe'
  const candidates = shellBinaryCandidates({
    platform: 'win32',
    pluginRoot,
    configured,
    env: { LOCALAPPDATA: localAppData },
  })
  assert.deepEqual(candidates, [
    configured,
    'C:\\repo\\desktop\\tauri\\target\\release\\big-fat-fish-girl-shell.exe',
    'C:\\Users\\fixture\\AppData\\Local\\Big Fat Fish Girl Shell\\big-fat-fish-girl-shell.exe',
    'C:\\Users\\fixture\\AppData\\Local\\Programs\\Big Fat Fish Girl Shell\\big-fat-fish-girl-shell.exe',
  ])
  assert.deepEqual(
    shellBinaryCandidates({ platform: 'win32', configured: 'relative\\shell.exe', env: {} }),
    [],
  )
  assert.equal(
    resolveShellBinary({
      platform: 'win32',
      pluginRoot,
      env: { LOCALAPPDATA: localAppData },
      exists: (path) => path === candidates[1],
    }),
    candidates[1],
  )
  assert.equal(
    resolveShellBinary({
      platform: 'win32',
      configured,
      env: {},
      exists: (path) => path === configured,
    }),
    configured,
  )
})

test('tasklist parsers accept only valid numeric PIDs and session IDs', () => {
  const selfPid = 4242
  const sessionOutput = [
    '"Image Name","PID","Session Name","Session#","Mem Usage"',
    tasklistRow('other.exe', 1234, 7),
    tasklistRow('node.exe', selfPid, '9007199254740992'),
    '"node.exe","4242","Console","not-a-session","12 K"',
    tasklistRow('node.exe', selfPid, 0),
    'INFO: No tasks are running which match the specified criteria.',
  ].join('\r\n')
  assert.equal(parseTasklistSessionId(sessionOutput, selfPid), 0, 'session zero is valid')
  assert.equal(parseTasklistSessionId(tasklistRow('node.exe', 4242, '9007199254740992'), selfPid), null)
  assert.equal(parseTasklistSessionId(tasklistRow('node.exe', '9007199254740992', 0), selfPid), null)

  const shellOutput = [
    '"Image Name","PID","Session Name","Session#","Mem Usage"',
    tasklistRow(shellImage.toUpperCase(), 1234, 0),
    tasklistRow(shellImage, 5678, 0),
    tasklistRow(shellImage, 9012, 1),
    tasklistRow(`${shellImage}.bak`, 3456, 0),
    tasklistRow(shellImage, 'not-a-pid', 0),
    tasklistRow(shellImage, '9007199254740992', 0),
    tasklistRow(shellImage, 7777, '9007199254740992'),
    '"malformed shell row',
    'INFO: No tasks are running which match the specified criteria.',
  ].join('\r\n')
  assert.deepEqual(parseTasklistPids(shellOutput, 0), [1234, 5678])
  assert.deepEqual(parseTasklistPids(shellOutput, Number.MAX_SAFE_INTEGER + 1), [])
  assert.deepEqual(parseTasklistPids(undefined, 0), [])
})

test('Windows detection filters to this session, ignores own PID, and uses bounded hidden queries', () => {
  const calls = []
  const reports = []
  const responses = [
    tasklistRow('node.exe', process.pid, 42),
    [
      tasklistRow(shellImage, 812, 41),
      tasklistRow(shellImage.toUpperCase(), process.pid, 42),
      tasklistRow(shellImage, 813, 42),
    ].join('\r\n'),
  ]
  const running = findRunningShell((file, args, options) => {
    calls.push({ file, args, options })
    return responses.shift()
  }, 'win32', (error) => reports.push(error))
  assert.equal(running, 813)
  assert.deepEqual(reports, [])
  assert.deepEqual(calls, [
    {
      file: 'tasklist',
      args: ['/FI', `PID eq ${process.pid}`, '/FO', 'CSV', '/NH'],
      options: { windowsHide: true, timeout: 2000 },
    },
    {
      file: 'tasklist',
      args: ['/FI', `IMAGENAME eq ${shellImage}`, '/FI', 'SESSION eq 42', '/FO', 'CSV', '/NH'],
      options: { windowsHide: true, timeout: 2000 },
    },
  ])

  let launched = false
  const existing = ensureShell({
    binary: 'C:\\shell.exe',
    running: () => running,
    launch: () => { launched = true; return { kill() {} } },
  })
  assert.equal(existing.started, false, 'a shell in this session prevents duplicate launch')
  existing.dispose()
  assert.equal(launched, false)
})

test('a shell in another Windows session does not prevent launch', () => {
  let launched = 0
  let killed = 0
  const responses = [
    tasklistRow('node.exe', process.pid, 42),
    tasklistRow(shellImage, 812, 41),
  ]
  const shell = ensureShell({
    binary: 'C:\\shell.exe',
    running: () => findRunningShell(() => responses.shift(), 'win32', () => assert.fail('no probe error expected')),
    launch: () => { launched += 1; return { kill() { killed += 1 } } },
  })
  assert.equal(shell.started, true)
  assert.equal(launched, 1)
  shell.dispose()
  assert.equal(killed, 1, 'dispose stops only the process launched by this plugin')
})

test('Windows tasklist operational failures and unknown sessions are reported', () => {
  const reports = []
  const failure = new Error('tasklist unavailable')
  let calls = 0
  assert.equal(findRunningShell(() => { calls += 1; throw failure }, 'win32', (error) => reports.push(error)), null)
  assert.deepEqual(reports, [failure])
  assert.equal(calls, 1)

  reports.length = 0
  calls = 0
  assert.equal(
    findRunningShell(() => { calls += 1; return '"Image Name","PID","Session Name","Session#"' }, 'win32', (error) => reports.push(error)),
    null,
  )
  assert.equal(calls, 1, 'do not query all shell processes when the current session is unknown')
  assert.equal(reports.length, 1)
  assert.match(reports[0].message, /valid session/)
})
