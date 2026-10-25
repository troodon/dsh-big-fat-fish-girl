import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

test('main ignores restored art sources and generated frames, but keeps runtime art and build metadata', (t) => {
  const fixture = mkdtempSync(join(tmpdir(), 'bffg-art-ignore-'))
  t.after(() => rmSync(fixture, { recursive: true, force: true }))
  copyFileSync(join(root, '.gitignore'), join(fixture, '.gitignore'))

  const kept = [
    'assets/source/deepseek-chan/README.md',
    'assets/source/deepseek-chan/PROMPTS.md',
    'assets/source/deepseek-chan/build-animation-atlases.py',
    'assets/source/deepseek-chan/build-manifest.json',
    'assets/source/deepseek-chan/registration.json',
    'lib/skins/deepseek-chan/spritesheet.png',
    'lib/skins/deepseek-chan/skin.json',
    'docs/preview/poses.png',
    'docs/preview/gifs/session.gif',
  ]
  const ignored = [
    'assets/source/deepseek-chan/boards/base-idle.png',
    'assets/source/deepseek-chan/frames/base-idle/frame-00.png',
    'assets/source/deepseek-chan/frames-256/base-idle/frame-00.png',
  ]
  for (const path of [...kept, ...ignored]) {
    const file = join(fixture, path)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, 'path-only fixture')
  }

  const git = (...args) => execFileSync('git', args, { cwd: fixture, encoding: 'utf8', timeout: 10_000 })
  git('init', '--quiet')
  git('add', '.')
  const tracked = git('ls-files', '-z').split('\0').filter(Boolean).sort()
  assert.deepEqual(tracked, ['.gitignore', ...kept].sort())
})
