// Force an initial HTTP failure, then require recovery and the native self-test.
// A fixed delay cannot guarantee a failed navigation on a slow CI WebView startup.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { server, patchState } from '../preview/server.mjs'

const executableSuffix = process.platform === 'win32' ? '.exe' : ''
const defaultBinary = fileURLToPath(new URL(`../desktop/tauri/target/release/big-fat-fish-girl-shell${executableSuffix}`, import.meta.url))
const desktopPath = '/big-fat-fish-girl/v1/desktop'

export async function verifyShellStartup({ binary = defaultBinary, launch = spawn, timeoutMs = 60000, report = console.log } = {}) {
  patchState({ prefs: { skin: 'deepseek-chan', randomActs: false, wander: false, reducedMotion: true } })
  let ready = false
  let rejectedDocuments = 0
  let desktopRequests = 0
  const failedNavigation = Promise.withResolvers()
  const gate = createServer((req, res) => {
    if (!ready) {
      if (req.method === 'GET' && req.url === desktopPath) {
        rejectedDocuments += 1
        res.once('finish', () => {
          ready = true
          failedNavigation.resolve()
        })
      }
      res.writeHead(503, { 'content-type': 'text/plain', 'cache-control': 'no-store' })
      res.end('Harness is not ready yet')
      return
    }
    if (req.method === 'GET' && req.url === desktopPath) desktopRequests += 1
    server.emit('request', req, res)
  })
  let child = null
  let exited = null
  let output = ''
  const failures = []
  try {
    await new Promise((resolveListen, reject) => {
      gate.once('error', reject)
      gate.listen(0, '127.0.0.1', resolveListen)
    })
    const url = `http://127.0.0.1:${gate.address().port}${desktopPath}`
    child = launch(binary, ['--self-test', '--url', url], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: process.platform === 'win32',
    })
    child.stdout.on('data', (data) => { output += data })
    child.stderr.on('data', (data) => { output += data })
    exited = new Promise((resolveExit, reject) => {
      child.once('error', reject)
      // close follows stdio draining, so the last self-test output is included.
      child.once('close', (code, signal) => resolveExit({ code, signal }))
    })
    await waitFor(Promise.race([
      failedNavigation.promise,
      exited.then(({ code, signal }) => {
        throw new Error(`shell exited before the server was ready (${signal ?? code})\n${output.trim() || '(no child output)'}`)
      }),
    ]), timeoutMs, () => new Error(`shell never attempted its initial desktop navigation\n${output.trim() || '(no child output)'}`))
    const result = await waitFor(
      exited,
      timeoutMs,
      () => new Error(`shell startup timed out after ${timeoutMs}ms\n${output.trim() || '(no child output)'}`),
    )
    assert.equal(result.code, 0, `native self-test failed (${result.signal ?? result.code})\n${output}`)
    assert.match(output, /tauri-self-test: OK/)
    assert.ok(rejectedDocuments > 0, 'the initial desktop navigation must actually fail')
    assert.equal(desktopRequests, 1, 'the mounted document must not be repeatedly reloaded')
    report(output.trim())
    report('shell-startup: OK — recovered after HTTP 503, one mounted desktop document')
  } catch (error) {
    failures.push(error)
  }

  const cleanup = await Promise.allSettled([
    child ? stopChild(child, exited) : Promise.resolve(),
    closePreviewServer(gate),
  ])
  for (const result of cleanup) {
    if (result.status === 'rejected') appendErrors(failures, result.reason)
  }
  throwErrors(failures, 'shell startup and cleanup failed')
  return { output, rejectedDocuments, desktopRequests }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await verifyShellStartup({ binary: process.argv[2] })
}

async function stopChild(child, exited) {
  if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) return

  const failures = []
  if (process.platform === 'win32') {
    try {
      await stopWindowsProcessTree(child.pid)
    } catch (error) {
      appendErrors(failures, error)
    }
  }

  if (child.exitCode === null && child.signalCode === null) {
    try {
      child.kill()
    } catch (error) {
      failures.push(error)
    }
  }
  try {
    await waitFor(exited, 5000, () => new Error('could not stop the shell process within 5000ms'))
  } catch (error) {
    appendErrors(failures, error)
  }
  throwErrors(failures, 'shell process cleanup failed')
}

async function stopWindowsProcessTree(pid) {
  const taskkill = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  let output = ''
  taskkill.stdout.on('data', (data) => { output += data })
  taskkill.stderr.on('data', (data) => { output += data })
  const closed = new Promise((resolve, reject) => {
    taskkill.once('error', reject)
    taskkill.once('close', (code, signal) => resolve({ code, signal }))
  })
  closed.catch(() => {})

  let result
  try {
    result = await waitFor(closed, 5000, () => new Error(`taskkill timed out for shell pid ${pid}\n${output.trim() || '(no taskkill output)'}`))
  } catch (error) {
    const failures = [error]
    if (taskkill.pid !== undefined && taskkill.exitCode === null && taskkill.signalCode === null) {
      try {
        taskkill.kill()
      } catch (killError) {
        failures.push(killError)
      }
      try {
        await waitFor(closed, 5000, () => new Error(`could not stop taskkill for shell pid ${pid}`))
      } catch (waitError) {
        appendErrors(failures, waitError)
      }
    }
    throwErrors(failures, 'taskkill cleanup failed')
  }

  if (result.code !== 0) {
    throw new Error(`taskkill failed for shell pid ${pid} (${result.signal ?? result.code})\n${output.trim() || '(no taskkill output)'}`)
  }
}

async function closePreviewServer(server) {
  const failures = []
  try {
    server.closeAllConnections()
  } catch (error) {
    failures.push(error)
  }
  if (server.listening) {
    try {
      await new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve())
      })
    } catch (error) {
      failures.push(error)
    }
  }
  throwErrors(failures, 'preview server cleanup failed')
}

async function waitFor(promise, timeoutMs, timeoutError) {
  const timeout = new AbortController()
  try {
    return await Promise.race([
      promise,
      delay(timeoutMs, null, { signal: timeout.signal }).then(() => { throw timeoutError() }),
    ])
  } finally {
    timeout.abort()
  }
}

function appendErrors(target, error) {
  if (error instanceof AggregateError) target.push(...error.errors)
  else target.push(error)
}

function throwErrors(errors, message) {
  if (errors.length === 1) throw errors[0]
  if (errors.length > 1) throw new AggregateError(errors, message)
}
