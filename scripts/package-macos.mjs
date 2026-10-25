import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { createReadStream } from 'node:fs'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const appName = 'Big Fat Fish Girl Shell.app'
const executableName = 'big-fat-fish-girl-shell'
const bundleIdentifier = 'dev.bffg.shell'
const commandTimeoutMs = 120_000
const maxCommandOutput = 4 * 1024 * 1024

export async function packageMacOSApp(appPathArg, outputDirectoryArg, {
  platform = process.platform,
  arch = process.arch,
  packageVersion = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version,
  run = runCommand,
} = {}) {
  if (platform !== 'darwin') throw new Error('macOS packaging must run on macOS')
  const executableArch = { arm64: 'arm64', x64: 'x86_64' }[arch]
  if (!executableArch) throw new Error(`unsupported macOS architecture: ${arch}`)
  if (typeof appPathArg !== 'string' || typeof outputDirectoryArg !== 'string') {
    throw new Error('usage: node scripts/package-macos.mjs <app-path> <output-directory>')
  }
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(packageVersion)) {
    throw new Error(`invalid package version: ${packageVersion}`)
  }

  const appPath = resolve(appPathArg)
  const outputDirectory = resolve(outputDirectoryArg)
  validateAppStructure(appPath)
  if (isSameOrInside(appPath, outputDirectory)) {
    throw new Error('output directory must not be inside the source app bundle')
  }

  const plistPath = join(appPath, 'Contents', 'Info.plist')
  const identifier = run('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleIdentifier', plistPath]).trim()
  if (identifier !== bundleIdentifier) {
    throw new Error(`unexpected bundle identifier: ${identifier || '(empty)'}`)
  }
  const version = run('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleShortVersionString', plistPath]).trim()
  if (version !== packageVersion) {
    throw new Error(`app version ${version || '(empty)'} does not match package.json version ${packageVersion}`)
  }

  const executablePath = join(appPath, 'Contents', 'MacOS', executableName)
  assertArchitecture(executablePath, executableArch, run)

  const archiveName = `big-fat-fish-girl-shell-${packageVersion}-macos-${arch}.zip`
  const archivePath = join(outputDirectory, archiveName)
  const checksumPath = `${archivePath}.sha256`
  mkdirSync(outputDirectory, { recursive: true })
  if (existsSync(archivePath) || existsSync(checksumPath)) {
    throw new Error(`release archive or checksum already exists: ${archiveName}`)
  }

  let temporaryDirectory = null
  const published = []
  const removeTemporaryDirectory = () => {
    if (!temporaryDirectory) return
    const directory = temporaryDirectory
    temporaryDirectory = null
    rmSync(directory, { recursive: true, force: true })
  }
  try {
    temporaryDirectory = mkdtempSync(join(outputDirectory, '.bffg-macos-'))
    const stagedApp = join(temporaryDirectory, appName)
    cpSync(appPath, stagedApp, { recursive: true, preserveTimestamps: true, verbatimSymlinks: true })
    const stagedExecutable = join(stagedApp, 'Contents', 'MacOS', executableName)

    run('codesign', ['--force', '--deep', '--sign', '-', '--timestamp=none', stagedApp])
    verifyAdHocSignature(stagedApp, run)

    const temporaryArchive = join(temporaryDirectory, archiveName)
    run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', stagedApp, temporaryArchive])
    if (!statSync(temporaryArchive).isFile() || statSync(temporaryArchive).size === 0) {
      throw new Error('ditto did not produce a non-empty archive')
    }

    const extractionDirectory = join(temporaryDirectory, 'extracted')
    mkdirSync(extractionDirectory)
    run('ditto', ['-x', '-k', temporaryArchive, extractionDirectory])
    const extractedApp = join(extractionDirectory, appName)
    validateAppStructure(extractedApp)
    verifyAdHocSignature(extractedApp, run)
    assertArchitecture(join(extractedApp, 'Contents', 'MacOS', executableName), executableArch, run)

    const digest = await sha256File(temporaryArchive)
    const temporaryChecksum = `${temporaryArchive}.sha256`
    writeFileSync(temporaryChecksum, `${digest}  ${archiveName}\n`, { flag: 'wx' })
    renameSync(temporaryArchive, archivePath)
    published.push(archivePath)
    renameSync(temporaryChecksum, checksumPath)
    published.push(checksumPath)
    return { archivePath, checksumPath, architecture: arch }
  } catch (error) {
    const failures = [error]
    for (const path of published) {
      try {
        rmSync(path, { force: true })
      } catch (cleanupError) {
        failures.push(cleanupError)
      }
    }
    try {
      removeTemporaryDirectory()
    } catch (cleanupError) {
      failures.push(cleanupError)
    }
    if (failures.length > 1) throw new AggregateError(failures, 'macOS packaging failed and cleanup was incomplete')
    throw error
  } finally {
    removeTemporaryDirectory()
  }
}

function validateAppStructure(appPath) {
  if (basename(appPath) !== appName || !lstatSync(appPath).isDirectory()) {
    throw new Error(`expected a ${appName} directory: ${appPath}`)
  }
  const plistPath = join(appPath, 'Contents', 'Info.plist')
  const executablePath = join(appPath, 'Contents', 'MacOS', executableName)
  if (!statSync(plistPath).isFile() || !statSync(executablePath).isFile()) {
    throw new Error(`app bundle is missing Contents/Info.plist or Contents/MacOS/${executableName}`)
  }
}

function assertArchitecture(executablePath, expectedArch, run) {
  const architectures = run('lipo', ['-archs', executablePath]).trim().split(/\s+/)
  if (!architectures.includes(expectedArch)) {
    throw new Error(`app executable does not contain required ${expectedArch} architecture (found: ${architectures.join(' ') || 'none'})`)
  }
}

function verifyAdHocSignature(appPath, run) {
  run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath])
  const details = run('codesign', ['-d', '--verbose=4', appPath])
  if (!/(^|\n)Signature=adhoc(?:\n|$)/.test(details)
    || !/(^|\n)TeamIdentifier=not set(?:\n|$)/.test(details)
    || /(^|\n)Authority=/.test(details)) {
    throw new Error(`app signature is not ad-hoc signed: ${appPath}`)
  }
}

function isSameOrInside(parent, child) {
  const pathFromParent = relative(parent, child)
  return pathFromParent === '' || (pathFromParent !== '..'
    && !pathFromParent.startsWith(`..${sep}`)
    && !isAbsolute(pathFromParent))
}

function runCommand(command, args) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    timeout: commandTimeoutMs,
    maxBuffer: maxCommandOutput,
    windowsHide: true,
  })
  if (result.error) throw new Error(`${command} could not run: ${result.error.message}`, { cause: result.error })
  if (result.status !== 0) {
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
    throw new Error(`${command} ${args.join(' ')} failed (${result.signal ?? result.status})${output ? `\n${output}` : ''}`)
  }
  return `${result.stdout ?? ''}${result.stderr ?? ''}`
}

function sha256File(path) {
  return new Promise((resolveHash, reject) => {
    const hash = createHash('sha256')
    const input = createReadStream(path)
    input.on('error', reject)
    input.on('data', (chunk) => hash.update(chunk))
    input.on('end', () => resolveHash(hash.digest('hex')))
  })
}

async function main(args) {
  if (args.length !== 2) {
    console.error('Usage: node scripts/package-macos.mjs <app-path> <output-directory>')
    process.exitCode = 2
    return
  }
  try {
    const result = await packageMacOSApp(args[0], args[1])
    console.log(`Created ${result.archivePath} and ${result.checksumPath} (ad-hoc signed; not notarized).`)
  } catch (error) {
    console.error('macOS packaging failed:', error)
    process.exitCode = 1
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main(process.argv.slice(2))
}
