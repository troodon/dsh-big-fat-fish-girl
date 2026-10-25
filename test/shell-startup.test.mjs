import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifyShellStartup } from '../scripts/verify-shell-startup.mjs'

const execFileAsync = promisify(execFile)
const verifier = fileURLToPath(new URL('../scripts/verify-shell-startup.mjs', import.meta.url))


test('startup verifier preserves a child spawn failure and exits without opening a GUI', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'bffg-shell-startup-'))
  const missingBinary = join(directory, process.platform === 'win32' ? 'missing-shell.exe' : 'missing-shell')

  try {
    await assert.rejects(
      execFileAsync(process.execPath, [verifier, missingBinary], {
        encoding: 'utf8',
        timeout: 10000,
        windowsHide: true,
      }),
      (error) => {
        assert.equal(error.code, 1, 'the verifier must fail for its child spawn error')
        assert.match(error.stderr, /ENOENT/)
        assert.match(error.stderr, /spawn/)
        return true
      },
    )

  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('startup recovery forces an initial failure even when the child starts after four seconds', { timeout: 20000 }, async () => {
  const source = `
    import assert from 'node:assert/strict'
    import { setTimeout } from 'node:timers/promises'
    await setTimeout(4500)
    const url = process.argv[process.argv.indexOf('--url') + 1]
    const failed = await fetch(url)
    assert.equal(failed.status, 503)
    await failed.text()
    const state = await fetch(new URL('state', url))
    assert.equal(state.status, 200)
    await state.text()
    const mounted = await fetch(url)
    assert.equal(mounted.status, 200)
    await mounted.text()
    console.log('tauri-self-test: OK')
    process.exit(0)
  `
  const result = await verifyShellStartup({
    launch: (_binary, args, options) => spawn(process.execPath, ['--input-type=module', '-e', source, '--', ...args], options),
    timeoutMs: 15000,
    report() {},
  })
  assert.equal(result.rejectedDocuments, 1)
  assert.equal(result.desktopRequests, 1)
  assert.doesNotMatch(result.output, /retrying desktop page/)
})

test('a self-test message without an attempted failed navigation is not a pass', async () => {
  await assert.rejects(verifyShellStartup({
    launch: (_binary, _args, options) => spawn(process.execPath, ['-e', "console.log('tauri-self-test: OK')"], options),
    timeoutMs: 2000,
    report() {},
  }), /shell exited before the server was ready/)
})

test('startup verifier reports a child exit before the server is ready', async () => {
  await assert.rejects(
    execFileAsync(process.execPath, [verifier, process.execPath], {
      encoding: 'utf8',
      timeout: 10000,
      windowsHide: true,
    }),
    (error) => {
      assert.equal(error.code, 1)
      assert.match(error.stderr, /shell exited before the server was ready/)
      return true
    },
  )
})
