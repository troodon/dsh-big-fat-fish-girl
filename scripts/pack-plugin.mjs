import { spawnSync } from 'node:child_process'
import { constants, copyFileSync, existsSync, mkdtempSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { DEFAULT_MANIFEST } from '../lib/animation/manifest-defaults.mjs'
import { DEFAULT_SKIN } from '../lib/settings/prefs.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const RUNTIME_FILES = [
  'package.json', 'README.md', 'LICENSE', 'ASSET_LICENSE.md', 'cordis.patch.yml',
  'desktop/pet.html', 'lib/client.js',
  'lib/host/aggregate.mjs', 'lib/host/host-adapter.mjs', 'lib/host/host-routes.mjs',
  'lib/host/index.mjs', 'lib/host/live-channel.mjs', 'lib/host/model.mjs',
  'lib/host/shell-launch.mjs', 'lib/host/shell-presence.mjs', 'lib/host/skins.mjs',
  'lib/host/snapshot.mjs',
  'lib/animation/manifest-defaults.mjs', 'lib/animation/manifest.mjs',
  'lib/animation/sheet-revisions.mjs', 'lib/animation/sheets.mjs',
  'lib/diagnostics.mjs',
  'lib/i18n/lines.en.mjs', 'lib/i18n/lines.mjs', 'lib/i18n/lines.ru.mjs',
  'lib/i18n/lines.zh-CN.mjs', 'lib/i18n/strings.mjs', 'lib/i18n/ui.en.mjs',
  'lib/i18n/ui.ru.mjs', 'lib/i18n/ui.zh-CN.mjs',
  'lib/protocol/contract.mjs', 'lib/settings/prefs.mjs',
]

export function expectedPackFiles(root = ROOT) {
  const skinRoot = join(root, 'lib', 'skins')
  const skinIds = readdirSync(skinRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
  if (!skinIds.includes(DEFAULT_SKIN)) throw new Error(`default skin is missing: ${DEFAULT_SKIN}`)

  const files = new Set(RUNTIME_FILES)
  for (const skinId of skinIds) {
    const prefix = `lib/skins/${skinId}`
    files.add(`${prefix}/skin.json`)
    for (const sheet of Object.values(DEFAULT_MANIFEST.sheets)) files.add(`${prefix}/${sheet.file}`)
  }
  return [...files].sort()
}

export function validatePackFiles(entries, expected = expectedPackFiles()) {
  const actual = entries.map((entry) => entry.path)
  const actualSet = new Set(actual)
  const expectedSet = new Set(expected)
  const duplicates = actual.filter((path, index) => actual.indexOf(path) !== index)
  const missing = expected.filter((path) => !actualSet.has(path))
  const unexpected = actual.filter((path) => !expectedSet.has(path))
  if (duplicates.length || missing.length || unexpected.length) {
    const details = [
      ...duplicates.map((path) => `duplicate: ${path}`),
      ...missing.map((path) => `missing: ${path}`),
      ...unexpected.map((path) => `unexpected: ${path}`),
    ]
    throw new Error(`npm pack file list is not runtime-only:\n${details.join('\n')}`)
  }
}

function runPack(destination) {
  const npmCli = process.env.npm_execpath
  if (!npmCli) throw new Error('npm_execpath is unavailable; run this through npm run pack')
  const outputDir = resolve(process.cwd(), destination ?? '.')
  mkdirSync(outputDir, { recursive: true })
  const stagingDir = mkdtempSync(join(outputDir, '.bffg-pack-stage-'))

  try {
    const result = spawnSync(process.execPath, [npmCli, 'pack', '--json', '--pack-destination', stagingDir], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 120_000,
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true,
    })
    if (result.error) throw new Error(`npm pack could not run: ${result.error.message}`)
    if (result.status !== 0) {
      throw new Error(`npm pack failed${result.stderr ? `:\n${result.stderr.trim()}` : ''}`)
    }

    let packed
    try {
      packed = JSON.parse(result.stdout)
    } catch (error) {
      throw new Error(`npm pack returned invalid JSON: ${error.message}`)
    }
    if (!Array.isArray(packed) || packed.length !== 1 || typeof packed[0].filename !== 'string'
      || !Array.isArray(packed[0].files)) {
      throw new Error('npm pack returned unexpected metadata')
    }
    const { filename, files } = packed[0]
    if (filename !== filename.split(/[\\/]/).pop()) throw new Error(`npm pack returned an unsafe filename: ${filename}`)
    validatePackFiles(files)

    const stagedArchive = join(stagingDir, filename)
    if (!existsSync(stagedArchive)) throw new Error(`npm pack did not create ${filename}`)
    const archivePath = join(outputDir, filename)
    copyFileSync(stagedArchive, archivePath, constants.COPYFILE_EXCL)
    process.stdout.write(`${filename}\n`)
  } finally {
    rmSync(stagingDir, { recursive: true, force: true })
  }
}


if (process.argv[1] && import.meta.url === pathToFileURL(isAbsolute(process.argv[1]) ? process.argv[1] : resolve(process.cwd(), process.argv[1])).href) {
  try {
    const args = process.argv.slice(2)
    if (args.length > 1) throw new Error('usage: npm run pack [-- <output-directory>]')
    runPack(args[0])
  } catch (error) {
    process.stderr.write(`pack-plugin: ${error.message}\n`)
    process.exitCode = 1
  }
}
