import test from 'node:test'
import assert from 'node:assert/strict'
import { gunzipSync } from 'node:zlib'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expectedPackFiles, validatePackFiles } from '../scripts/pack-plugin.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packScript = join(root, 'scripts', 'pack-plugin.mjs')
const { name: packageName, version: packageVersion } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const archiveName = `${packageName}-${packageVersion}.tgz`

function tarFiles(archive) {
  const tar = gunzipSync(readFileSync(archive))
  const files = []
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512)
    if (header.every((byte) => byte === 0)) break
    const field = (start, length) => tar.subarray(offset + start, offset + start + length)
      .toString('utf8').replace(/\0.*$/, '').trim()
    const name = field(0, 100)
    const prefix = field(345, 155)
    const path = prefix ? `${prefix}/${name}` : name
    const size = Number.parseInt(field(124, 12) || '0', 8)
    const type = field(156, 1)
    if (type === '' || type === '0') {
      assert.ok(path.startsWith('package/'), `unexpected tar root: ${path}`)
      files.push({ path: path.slice('package/'.length), size })
    }
    offset += 512 + Math.ceil(size / 512) * 512
  }
  return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
}

test('the pack manifest requires all runtime files and rejects extra or missing entries', () => {
  const expected = expectedPackFiles(root)
  validatePackFiles(expected.map((path) => ({ path })), expected)
  assert.throws(() => validatePackFiles([
    ...expected.map((path) => ({ path })),
    { path: 'docs/preview/idle.gif' },
  ], expected), /unexpected: docs\/preview\/idle\.gif/)
  assert.throws(() => validatePackFiles(expected.slice(1).map((path) => ({ path })), expected), /missing:/)
})

const npmContextAvailable = typeof process.env.npm_execpath === 'string' && process.env.npm_execpath !== ''
test('npm pack emits a checked runtime-only archive with the installed atlases', {
  skip: npmContextAvailable ? false : 'run through npm so npm_execpath is available',
}, () => {
  const temp = mkdtempSync(join(tmpdir(), 'bffg pack artifact with spaces-'))
  try {
    const output = join(temp, 'release assets')
    mkdirSync(output)
    writeFileSync(join(output, 'keep.txt'), 'unrelated output stays untouched')
    const invokePack = () => spawnSync(process.execPath, [packScript, output], {
      cwd: root,
      encoding: 'utf8',
      timeout: 180_000,
      windowsHide: true,
      env: { ...process.env, NPM_CONFIG_CACHE: join(temp, 'npm-cache') },
    })
    const result = invokePack()
    assert.equal(result.status, 0, result.stderr || result.error?.message)
    assert.equal(result.stdout, `${archiveName}\n`, 'stdout is only the archive basename')
    assert.deepEqual(readdirSync(output).sort(), [archiveName, 'keep.txt'])

    const archive = join(output, archiveName)
    const packedFiles = tarFiles(archive)
    assert.deepEqual(packedFiles.map(({ path }) => path), expectedPackFiles(root))
    const unpackedBytes = packedFiles.reduce((sum, file) => sum + file.size, 0)
    assert.ok(statSync(archive).size < 15 * 1024 * 1024, 'compressed runtime package should stay under 15 MiB')
    assert.ok(unpackedBytes < 15 * 1024 * 1024, 'unpacked runtime package should stay under 15 MiB')
    for (const path of expectedPackFiles(root).filter((path) => path.startsWith('lib/skins/'))) {
      assert.ok(packedFiles.some((file) => file.path === path), `${path} must remain in the installed package`)
    }

    const originalArchive = readFileSync(archive)
    const overwrite = invokePack()
    assert.notEqual(overwrite.status, 0, 'a second pack must not overwrite the existing archive')
    assert.equal(overwrite.stdout, '')
    assert.match(overwrite.stderr, /EEXIST|already exists/)
    assert.deepEqual(readFileSync(archive), originalArchive)
    assert.deepEqual(readdirSync(output).sort(), [archiveName, 'keep.txt'])
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
})

test('the CLI rejects an npm artifact containing a preview GIF and removes staging output', () => {
  const temp = mkdtempSync(join(tmpdir(), 'bffg pack rejection-'))
  try {
    const output = join(temp, 'release assets')
    mkdirSync(output)
    writeFileSync(join(output, 'keep.txt'), 'unrelated output stays untouched')
    const fakeCli = join(temp, 'fake-npm-cli.mjs')
    const filename = archiveName
    const files = [
      ...expectedPackFiles(root).map((path) => ({ path, size: 1, mode: 420 })),
      { path: 'docs/preview/idle.gif', size: 1, mode: 420 },
    ]
    const metadata = JSON.stringify([{
      id: `${packageName}@${packageVersion}`,
      name: packageName,
      version: packageVersion,
      size: 1,
      unpackedSize: files.length,
      shasum: 'test',
      integrity: 'sha512-test',
      filename,
      files,
    }])
    writeFileSync(fakeCli, [
      "import { writeFileSync } from 'node:fs'",
      "import { join } from 'node:path'",
      "const args = process.argv.slice(2)",
      "const destination = args[args.indexOf('--pack-destination') + 1]",
      `writeFileSync(join(destination, ${JSON.stringify(filename)}), 'staged archive')`,
      `process.stdout.write(${JSON.stringify(metadata)})`,
      '',
    ].join('\n'))

    const result = spawnSync(process.execPath, [packScript, output], {
      cwd: root,
      encoding: 'utf8',
      timeout: 10_000,
      windowsHide: true,
      env: { ...process.env, npm_execpath: fakeCli },
    })
    assert.notEqual(result.status, 0)
    assert.equal(result.stdout, '')
    assert.match(result.stderr, /unexpected: docs\/preview\/idle\.gif/)
    assert.deepEqual(readdirSync(output), ['keep.txt'])
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
})
