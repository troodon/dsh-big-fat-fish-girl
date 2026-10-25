import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { DEFAULT_MANIFEST } from '../lib/animation/manifest.mjs'
import { DEFAULT_SKIN } from '../lib/host/skins.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// npm understands in `files` only plain paths, directory prefixes and a single `*`.
const matches = (pattern, path) => {
  if (!pattern.includes('*')) return pattern.endsWith('/') ? path.startsWith(pattern) : path === pattern
  const [head, tail] = pattern.split('*')
  return path.startsWith(head) && path.endsWith(tail ?? '')
}

test('package metadata and source IDs match the official web bundle shape', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  const patch = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
  const client = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  assert.equal(pkg.name, 'big-fat-fish-girl')
  assert.equal(pkg.main, './lib/host/index.mjs')
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(pkg.dsh.client.platform, 'web')
  assert.match(patch, /id: big-fat-fish-girl/)
  assert.match(patch, /name: big-fat-fish-girl/)
  assert.match(client, /id: \"big-fat-fish-girl\"/)
  assert.match(client, /factory: \(require\) =>/)
  assert.equal(existsSync(new URL('../lib/host/index.mjs', import.meta.url)), true)
  assert.equal(existsSync(new URL(`../lib/skins/${DEFAULT_SKIN}/spritesheet.png`, import.meta.url)), true)
})

test('plugin, lockfiles and native shell share one release version', () => {
  const json = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'))
  const pkg = json('../package.json')
  const lock = json('../package-lock.json')
  const tauri = json('../desktop/tauri/src-tauri/tauri.conf.json')
  const cargo = readFileSync(new URL('../desktop/tauri/src-tauri/Cargo.toml', import.meta.url), 'utf8')
  const cargoLock = readFileSync(new URL('../desktop/tauri/Cargo.lock', import.meta.url), 'utf8')
  assert.equal(lock.version, pkg.version, 'npm lockfile version')
  assert.equal(lock.packages[''].version, pkg.version, 'npm root package version')
  assert.equal(tauri.version, pkg.version, 'Tauri bundle version')
  assert.equal(cargo.match(/^version = "([^"]+)"/m)?.[1], pkg.version, 'Rust shell version')
  assert.equal(cargoLock.match(/name = "big-fat-fish-girl-shell"\nversion = "([^"]+)"/)?.[1],
    pkg.version, 'Rust lockfile shell version')
})

test('all explicit npm files entries exist', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  for (const path of pkg.files) {
    if (path.includes('*')) continue
    assert.equal(existsSync(new URL(`../${path}`, import.meta.url)), true,
      `package.json files references missing path: ${path}`)
  }
})

test('npm scripts reference existing local tools', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  for (const [name, command] of Object.entries(pkg.scripts)) {
    for (const [, path] of command.matchAll(/\b(?:node|python3|sh) ((?:scripts|assets)\/[^\s]+)/g)) {
      assert.equal(existsSync(new URL(`../${path}`, import.meta.url)), true, `${name} references missing ${path}`)
    }
  }
})

test('the runtime package allowlist excludes demos, source art, and developer files', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  const excluded = [
    'CHANGELOG.md', 'docs/INSTALL.md', 'docs/preview/idle.gif',
    'assets/source/deepseek-chan/original.png', 'desktop/pet-desktop.mjs',
    'desktop/README.md', 'scripts/pack-plugin.mjs',
    'lib/animation/engine.mjs', 'lib/animation/skin-profiles.mjs', 'lib/i18n/usage.mjs',
    'lib/behavior/', 'lib/rendering/', 'lib/web/',
  ]
  for (const path of excluded) {
    assert.equal(pkg.files.some((pattern) => matches(pattern, path)), false, `${path} must stay out of the package`)
  }
  assert.ok(pkg.files.includes('lib/skins/'), 'runtime skin discovery needs the installed skin directory')
})

test('все листы манифеста попадают в npm-пакет (регресс: новый арт не публиковался)', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  for (const [id, sheet] of Object.entries(DEFAULT_MANIFEST.sheets)) {
    const path = `lib/skins/${DEFAULT_SKIN}/${sheet.file}`
    const covered = pkg.files.some((pattern) => matches(pattern, path))
    assert.ok(covered, `лист "${id}" (${path}) не попадёт в пакет: добавь его в files`)
    const exists = existsSync(new URL(`../${path}`, import.meta.url))
    // Optional sheets can be declared before their art is available.
    if (sheet.optional === true && !exists) continue
    assert.equal(exists, true, `${path} должен существовать`)
  }
})

test('единственная рантайм-зависимость — schemastery для схемы настроек', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  // Регресс: jsdom стоял в dependencies и притягивал всё дерево, хотя нужен лишь тестам.
  // schemastery — маленькая и нужна, чтобы Harness отрисовал настройки плагина.
  assert.deepEqual(Object.keys(pkg.dependencies ?? {}), ['@deepseek-ai/schemastery'])
  assert.equal(pkg.dependencies.jsdom, undefined, 'jsdom не должен вернуться в зависимости')
  assert.ok(pkg.devDependencies?.jsdom, 'jsdom остаётся инструментом разработки')
})

// Каталог dsh.pub читает корневой package.json: без этих полей и ссылок на репозиторий
// плагин не проходит валидацию бандла и не получа Issue-трекера в README.
test('пакет несёт метаданные для публичного реестра', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(pkg.repository?.type, 'git')
  assert.equal(pkg.repository?.url, 'git+https://github.com/troodon/dsh-big-fat-fish-girl.git')
  assert.equal(pkg.homepage, 'https://github.com/troodon/dsh-big-fat-fish-girl#readme')
  assert.equal(pkg.bugs?.url, 'https://github.com/troodon/dsh-big-fat-fish-girl/issues')
  assert.equal(pkg.author, 'troodon')
  assert.equal(pkg.license, 'Unlicense')
  assert.equal(pkg.engines?.node, '>=22')
})

test('README ссылается только на существующие файлы и картинки', () => {
  for (const readme of ['README.md']) {
    const body = readFileSync(new URL(`../${readme}`, import.meta.url), 'utf8')
    for (const [, target] of body.matchAll(/\]\(([^)#]+?)\)/g)) {
      if (/^(https?:|mailto:)/.test(target)) continue
      const path = target.split('#')[0]
      if (path === '') continue
      assert.equal(existsSync(new URL(`../${path}`, import.meta.url)), true,
        `${readme} ссылается на отсутствующий ${path}`)
    }
    for (const [, target] of body.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) {
      // Badges are remote URLs by nature; local pictures are the ones that can rot.
      if (/^https?:/.test(target)) continue
      assert.equal(existsSync(new URL(`../${target}`, import.meta.url)), true,
        `${readme} показывает отсутствующую картинку ${target}`)
    }
  }
})

test('README uses the documented dsh.pub status badge and repository-filtered catalog link', () => {
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8')
  const badge = 'https://dsh.pub/api/badges/troodon/dsh-big-fat-fish-girl.svg'
  const catalog = 'https://dsh.pub/en/plugins/?q=troodon%2Fdsh-big-fat-fish-girl'
  assert.ok(readme.includes(`[![dsh.pub registry status](${badge})](${catalog})`))
})

test('every host-reachable local import is included in the package', async () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  const result = await build({
    entryPoints: [resolve(root, 'lib/host/index.mjs')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    write: false,
    metafile: true,
  })
  const inputs = Object.keys(result.metafile.inputs)
    .filter((path) => !path.startsWith('node_modules/'))
    .map((path) => (isAbsolute(path) ? relative(root, path) : path).replaceAll('\\', '/'))
  assert.ok(inputs.length > 0, 'esbuild should report local host inputs')
  for (const file of inputs) {
    assert.ok(pkg.files.some((pattern) => matches(pattern, file)), `${file} is host-reachable but not packaged`)
  }
})
