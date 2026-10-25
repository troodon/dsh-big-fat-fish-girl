import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const python = process.env.PYTHON ?? 'python3'
const requirePillow = process.env.PREVIEW_TESTS_REQUIRE_PILLOW === '1'
const pillowProbe = spawnSync(python, [
  '-c',
  "import PIL; print(PIL.__version__)",
], { encoding: 'utf8' })
const pillowVersion = pillowProbe.status === 0 ? pillowProbe.stdout.trim() : null
const skipReason = !requirePillow && pillowVersion !== '11.3.0'
  ? 'Pillow 11.3.0 is optional for npm test; run the preview-art CI step to exercise these checks.'
  : false

test('atlas rebuild explains missing optional art sources without changing runtime files', {
  skip: skipReason,
}, (t) => {
  assert.equal(pillowProbe.status, 0, 'Pillow is required for atlas builder checks')
  const fixture = mkdtempSync(join(tmpdir(), 'bffg-atlas-without-sources-'))
  t.after(() => rmSync(fixture, { recursive: true, force: true }))
  const source = 'assets/source/deepseek-chan'
  const script = join(fixture, source, 'build-animation-atlases.py')
  const runtime = join(fixture, 'lib/skins/deepseek-chan/spritesheet.png')
  mkdirSync(dirname(script), { recursive: true })
  mkdirSync(dirname(runtime), { recursive: true })
  copyFileSync(join(root, source, 'build-animation-atlases.py'), script)
  writeFileSync(runtime, 'existing runtime atlas')

  for (const args of [[], ['--verify']]) {
    const result = spawnSync(python, [script, ...args], { encoding: 'utf8', timeout: 10_000 })
    assert.equal(result.status, 1, result.stderr)
    assert.equal(result.stdout, '')
    assert.match(result.stderr, /Editable frames are not installed/)
    assert.match(result.stderr, /art-source/)
    assert.match(result.stderr, /assets\/source\/deepseek-chan\/README\.md/)
    assert.equal(readFileSync(runtime, 'utf8'), 'existing runtime atlas')
    assert.equal(existsSync(join(fixture, source, 'frames-256')), false)
    assert.equal(existsSync(join(fixture, source, 'build-manifest.json')), false)
  }
})

const fixtureScript = `
from pathlib import Path
from PIL import Image
import shutil
import sys

expected = Path(sys.argv[1])
actual = Path(sys.argv[2])
mode = sys.argv[3]


def make_png(path, change_pixel, change_size, compress_level):
    size = (65, 64) if change_size else (64, 64)
    image = Image.new('RGBA', size, (25, 54, 101, 255))
    if change_pixel:
        image.putpixel((2, 3), (26, 54, 101, 255))
    image.save(path, format='PNG', compress_level=compress_level)


def make_gif(path, variant, is_actual):
    frames = [Image.new('RGB', (8, 8), (220, 10, 20)), Image.new('RGB', (8, 8), (10, 20, 220))]
    durations = [100, 200]
    loop = 0
    if is_actual and variant == 'pixel':
        frames[0].putpixel((1, 1), (20, 220, 10))
    if is_actual and variant == 'frame-count':
        frames.append(Image.new('RGB', (8, 8), (20, 220, 10)))
        durations.append(100)
    if is_actual and variant == 'timing':
        durations[0] = 110
    if is_actual and variant == 'loop':
        loop = 1
    frames[0].save(
        path,
        save_all=True,
        append_images=frames[1:],
        duration=durations,
        loop=loop,
        disposal=2,
        optimize=True,
    )
    if is_actual and variant == 'reencoded':
        encoded = path.read_bytes()
        assert encoded.endswith(b';')
        path.write_bytes(encoded[:-1] + b'!\\xfe\\x04test\\x00;')


for directory, is_actual in ((expected, False), (actual, True)):
    (directory / 'gifs').mkdir(parents=True)
    make_png(directory / 'poses.png', is_actual and mode == 'pixel', is_actual and mode == 'dimensions', 9 if is_actual else 1)
    make_png(directory / 'gaze.png', False, False, 9 if is_actual else 1)
    make_gif(directory / 'idle.gif', mode if is_actual else 'baseline', is_actual)
    make_gif(directory / 'gifs' / 'session.gif', 'baseline', False)

if mode == 'missing-extra':
    (actual / 'gifs' / 'session.gif').unlink()
    shutil.copyfile(actual / 'idle.gif', actual / 'gifs' / 'stale.gif')
`

function makeFixture(directory, mode) {
  const expected = join(directory, 'expected')
  const actual = join(directory, 'actual')
  const result = spawnSync(python, ['-c', fixtureScript, expected, actual, mode], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr || result.error?.message || 'could not create image fixtures')
  return { expected, actual }
}

function compare(expected, actual) {
  return spawnSync(python, [join(root, 'scripts', 'compare-preview.py'), expected, actual], { encoding: 'utf8' })
}

function generatedSnapshot(directory) {
  const files = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isFile() && /\.(png|gif)$/i.test(entry.name)) files.push(entry.name)
  }
  const gifDirectory = join(directory, 'gifs')
  for (const entry of readdirSync(gifDirectory, { withFileTypes: true })) {
    if (entry.isFile() && /\.gif$/i.test(entry.name)) files.push(join('gifs', entry.name))
  }
  return Object.fromEntries(files.sort().map((name) => [
    name,
    createHash('sha256').update(readFileSync(join(directory, name))).digest('hex'),
  ]))
}

test('preview artwork check compares decoded output and never overwrites committed files', {
  skip: skipReason,
}, async (t) => {
  assert.equal(pillowProbe.status, 0, `Pillow is required here: ${pillowProbe.error?.message ?? pillowProbe.stderr}`)
  assert.equal(pillowVersion, '11.3.0', 'install scripts/preview-requirements.txt before running preview checks')

  const tempRoot = mkdtempSync(join(tmpdir(), 'big-fat-fish-girl-preview-test-'))
  t.after(() => rmSync(tempRoot, { recursive: true, force: true }))

  await t.test('accepts lossless PNG re-encoding and GIF metadata changes', () => {
    const { expected, actual } = makeFixture(join(tempRoot, 'reencoded'), 'reencoded')
    assert.notDeepEqual(readFileSync(join(expected, 'poses.png')), readFileSync(join(actual, 'poses.png')))
    assert.notDeepEqual(readFileSync(join(expected, 'idle.gif')), readFileSync(join(actual, 'idle.gif')))
    const result = compare(expected, actual)
    assert.equal(result.status, 0, result.stderr || result.stdout)
  })

  await t.test('rejects dimension changes', () => {
    const { expected, actual } = makeFixture(join(tempRoot, 'dimensions'), 'dimensions')
    const result = compare(expected, actual)
    assert.equal(result.status, 1, result.stdout)
    assert.match(result.stderr, /poses\.png: dimensions differ/)
  })

  await t.test('rejects a one-pixel RGBA difference', () => {
    const { expected, actual } = makeFixture(join(tempRoot, 'pixel'), 'pixel')
    const result = compare(expected, actual)
    assert.equal(result.status, 1, result.stdout)
    assert.match(result.stderr, /poses\.png: RGBA pixels differ/)
    assert.match(result.stderr, /idle\.gif: frame 0 RGBA pixels differ/)
  })

  for (const [mode, message] of [
    ['frame-count', /idle\.gif: frame count differs/],
    ['timing', /idle\.gif: frame 0 duration differs/],
    ['loop', /idle\.gif: loop count differs/],
  ]) {
    await t.test(`rejects GIF ${mode} changes`, () => {
      const { expected, actual } = makeFixture(join(tempRoot, mode), mode)
      const result = compare(expected, actual)
      assert.equal(result.status, 1, result.stdout)
      assert.match(result.stderr, message)
    })
  }

  await t.test('rejects missing and extra generated GIFs', () => {
    const { expected, actual } = makeFixture(join(tempRoot, 'missing-extra'), 'missing-extra')
    const result = compare(expected, actual)
    assert.equal(result.status, 1, result.stdout)
    assert.match(result.stderr, /missing generated preview: gifs\/session\.gif/)
    assert.match(result.stderr, /unexpected generated preview: gifs\/stale\.gif/)
  })

  await t.test('check mode leaves committed image files untouched', () => {
    const previewDirectory = join(root, 'docs', 'preview')
    const before = generatedSnapshot(previewDirectory)
    const result = spawnSync(process.execPath, [join(root, 'scripts', 'build-preview.mjs'), '--check'], {
      cwd: root,
      encoding: 'utf8',
    })
    assert.equal(result.status, 0, result.stderr || result.stdout)
    assert.match(result.stdout, /Preview RGBA pixels and GIF frame timing\/loop match/)
    assert.deepEqual(generatedSnapshot(previewDirectory), before)
  })
})
