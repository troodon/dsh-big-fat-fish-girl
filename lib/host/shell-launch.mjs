// Start and stop the standalone desktop shell together with the plugin.
//
// The shell is a separate artifact on purpose: installing the plugin installs no
// runtime, no Rust and no binary, and a shell can be launched by hand at any time.
// But a companion that must be launched by hand every session is a chore, so when the
// shell binary is present the plugin starts it with Harness and stops exactly the
// process it started. A shell the user launched themselves (or one left over from an
// earlier run) is left untouched — the pid check never touches what it did not start.
import { execFileSync, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { posix, win32 } from 'node:path'
import { API_PREFIX } from '../protocol/contract.mjs'

/** The binary name doubles as the pgrep pattern. */
export const SHELL_PROCESS_NAME = 'big-fat-fish-girl-shell'
/** The binary's path segment, followed by arguments or the end of the line: a shell
 * launched with `--url …` must still count, while a stray command that merely
 * mentions the name has no slash before it. */
const SHELL_PGREP_PATTERN = '/' + SHELL_PROCESS_NAME + '( |$)'
const MACOS_BUNDLE = 'Big Fat Fish Girl Shell.app'
const MACOS_BINARY = posix.join('Contents', 'MacOS', SHELL_PROCESS_NAME)
const WINDOWS_BINARY = `${SHELL_PROCESS_NAME}.exe`
const TASKLIST_OPTIONS = { windowsHide: true, timeout: 2000 }
const TASKLIST_ROW = /^"([^"]*)","([^"]*)","[^"]*","([^"]*)"(?:,|$)/

/** pgrep prints one pid per line; anything unparsable is ignored. */
export function parsePids(stdout) {
  return String(stdout ?? '')
    .split(/\s+/)
    .filter((value) => /^\d+$/.test(value))
    .map(Number)
}

/** A running shell pid that is not this process. */
export function otherShellPid(pids, self = process.pid) {
  return pids.find((pid) => pid !== self) ?? null
}

function defaultExec(file, args, options = {}) {
  return execFileSync(file, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    ...options,
  })
}

function safePid(value) {
  const pid = Number(value)
  return /^\d+$/.test(value) && Number.isSafeInteger(pid) && pid > 0 ? pid : null
}

function safeSessionId(value) {
  const sessionId = Number(value)
  return /^\d+$/.test(value) && Number.isSafeInteger(sessionId) ? sessionId : null
}

function parseTasklistRow(line) {
  const match = TASKLIST_ROW.exec(line)
  if (match === null) return null
  return { imageName: match[1], pid: safePid(match[2]), sessionId: safeSessionId(match[3]) }
}

/** Get this process's numeric Windows session ID from its tasklist row. */
export function parseTasklistSessionId(stdout, self = process.pid) {
  for (const line of String(stdout ?? '').split(/\r?\n/)) {
    const row = parseTasklistRow(line)
    if (row?.pid === self && row.sessionId !== null) return row.sessionId
  }
  return null
}

/** Parse only exact shell-image rows in the current Windows session. */
export function parseTasklistPids(stdout, sessionId) {
  if (!Number.isSafeInteger(sessionId) || sessionId < 0) return []
  const pids = []
  for (const line of String(stdout ?? '').split(/\r?\n/)) {
    const row = parseTasklistRow(line)
    if (row?.imageName.toLowerCase() === WINDOWS_BINARY && row.pid !== null && row.sessionId === sessionId) {
      pids.push(row.pid)
    }
  }
  return pids
}

function defaultProbeReport(error) {
  console.warn('big-fat-fish-girl: could not check whether the desktop shell is already running:', error?.message ?? String(error))
}

/** The pid of a shell that is already running, or null. */
export function findRunningShell(exec = defaultExec, platform = process.platform, report = defaultProbeReport) {
  try {
    if (platform === 'win32') {
      const ownArgs = ['/FI', `PID eq ${process.pid}`, '/FO', 'CSV', '/NH']
      const ownSession = parseTasklistSessionId(exec('tasklist', ownArgs, TASKLIST_OPTIONS))
      if (ownSession === null) throw new Error('tasklist did not return a valid session for this process')
      const shellArgs = [
        '/FI', `IMAGENAME eq ${WINDOWS_BINARY}`,
        '/FI', `SESSION eq ${ownSession}`,
        '/FO', 'CSV', '/NH',
      ]
      const stdout = exec('tasklist', shellArgs, TASKLIST_OPTIONS)
      return otherShellPid(parseTasklistPids(stdout, ownSession))
    }
    if (platform !== 'darwin') return null
    // The pattern matches the binary's path segment; a terminal command that only
    // mentions the name (comments, notes) has no slash before it and does not match.
    return otherShellPid(parsePids(exec('pgrep', ['-f', SHELL_PGREP_PATTERN])))
  } catch (error) {
    // pgrep uses exit status 1 for a normal no-match; other probe failures are actionable.
    if (platform === 'darwin' && error?.status === 1) return null
    report(error)
    return null
  }
}

/**
 * Where the shell might live, in order of preference: an explicit path, the build
 * output next to this plugin (development), then the installed app. A `.app` path on
 * macOS is expanded to its executable; Windows paths use Windows path semantics even
 * when candidates are inspected from tests running on another platform.
 */
export function shellBinaryCandidates({ platform = process.platform, pluginRoot = '', configured = '', env = process.env } = {}) {
  if (platform === 'win32') {
    const candidates = []
    const configuredPath = typeof configured === 'string' ? configured.trim() : ''
    if (configuredPath !== '' && win32.isAbsolute(configuredPath)) candidates.push(configuredPath)
    if (pluginRoot !== '') {
      candidates.push(win32.join(pluginRoot, 'desktop', 'tauri', 'target', 'release', WINDOWS_BINARY))
    }
    const localAppData = typeof env?.LOCALAPPDATA === 'string' ? env.LOCALAPPDATA.trim() : ''
    if (localAppData !== '') {
      candidates.push(win32.join(localAppData, 'Big Fat Fish Girl Shell', WINDOWS_BINARY))
      candidates.push(win32.join(localAppData, 'Programs', 'Big Fat Fish Girl Shell', WINDOWS_BINARY))
    }
    return candidates
  }
  if (platform !== 'darwin') return []
  const candidates = []
  if (typeof configured === 'string' && configured.trim() !== '') candidates.push(configured.trim())
  if (pluginRoot !== '') {
    candidates.push(posix.join(pluginRoot, 'desktop', 'tauri', 'target', 'release', 'bundle', 'macos', MACOS_BUNDLE))
  }
  if (typeof env?.HOME === 'string' && posix.isAbsolute(env.HOME)) {
    candidates.push(posix.join(env.HOME, 'Applications', MACOS_BUNDLE))
  }
  candidates.push(posix.join('/Applications', MACOS_BUNDLE))
  return candidates.map((candidate) => (candidate.endsWith('.app') ? posix.join(candidate, MACOS_BINARY) : candidate))
}

/** The first candidate that exists on disk, or null. */
export function resolveShellBinary(options = {}) {
  const exists = options.exists ?? existsSync
  for (const candidate of shellBinaryCandidates(options)) {
    if (exists(candidate)) return candidate
  }
  return null
}

/**
 * The desktop page URL when the host's web server exposes its bound origin, or null.
 *
 * Harness 0.2.1 binds an OS-assigned loopback port (`--port 0`, e.g. 50543), so a shell
 * that only probes the old fixed port (19387) finds nothing. The plugin hands the shell
 * the origin it is actually serving on; versions without `getOrigin` return null and the
 * shell's own discovery stays the fallback.
 */
export function desktopPageUrl(webServer) {
  if (typeof webServer?.getOrigin !== 'function') return null
  try {
    return new URL(`${API_PREFIX}/desktop`, webServer.getOrigin()).href
  } catch {
    // No URL form (or the port is not bound yet): the shell's discovery covers those hosts.
    return null
  }
}

function defaultLaunch(binary, onError, args) {
  const child = spawn(binary, args, { detached: true, stdio: 'ignore' })
  // A missing or non-executable binary arrives as an 'error' event, not a throw. Without a
  // listener Node would take the whole Harness process down with it.
  child.once('error', onError)
  child.unref()
  return child
}

function defaultReport(error) {
  console.warn('big-fat-fish-girl: desktop shell:', error?.message ?? String(error))
}

/**
 * The whole lifecycle in one testable place: start the shell unless one already runs,
 * observe its exit, and return a disposer that stops exactly the process started here.
 * Launch, unexpected exit, and stop failures are reported.
 *
 * `args` is how the shell learns which page to load when the host binds an OS-assigned
 * port (`['--url', page]`); an empty list keeps the shell's own discovery.
 */
export function ensureShell({
  autoStart = true, binary = null, args = [], running = findRunningShell, launch = defaultLaunch, report = defaultReport,
} = {}) {
  const idle = { started: false, dispose() {} }
  if (autoStart === false || binary === null) return idle
  if (running() !== null) return idle
  let child = null
  let launchFailed = false
  const onError = (error) => {
    launchFailed = true
    child = null
    report(error)
  }
  try {
    const launchedChild = launch(binary, onError, args)
    if (launchFailed) return idle
    child = launchedChild
    launchedChild?.once?.('exit', (code, signal) => {
      if (child !== launchedChild) return
      child = null
      if (code !== 0 || signal) {
        const reason = signal ? `signal ${signal}` : `exit code ${code}`
        report(new Error(`desktop shell stopped unexpectedly (${reason})`))
      }
    })
  } catch (error) {
    onError(error)
    return idle
  }
  return {
    get started() {
      return child !== null
    },
    dispose() {
      const ownedChild = child
      if (ownedChild === null) return
      child = null
      try {
        ownedChild.kill()
      } catch (error) {
        report(error)
      }
    },
  }
}
