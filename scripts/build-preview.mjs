// Renders README artwork straight from the atlas, so the pictures can never drift
// away from the art. Install the pinned renderer with:
//   python3 -m pip install --requirement scripts/preview-requirements.txt
//
//   node scripts/build-preview.mjs [--root .] [--skin <id>] [--check]
//
// `--skin` picks which installed skin the pictures are rendered from; it defaults to
// the skin the pet itself starts with (lib/host/skins.mjs), so the README art and the
// default pet cannot disagree.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_MANIFEST, indexManifest } from '../lib/animation/manifest.mjs'
import { DEFAULT_SKIN } from '../lib/host/skins.mjs'

const root = resolve(process.argv.includes('--root')
  ? process.argv[process.argv.indexOf('--root') + 1]
  : join(dirname(fileURLToPath(import.meta.url)), '..'))

const skin = process.argv.includes('--skin')
  ? process.argv[process.argv.indexOf('--skin') + 1]
  : DEFAULT_SKIN

const index = indexManifest(DEFAULT_MANIFEST)
const payload = {
  root,
  // The README artwork is rendered from one skin's atlases.
  skinsDir: join('lib', 'skins', skin),
  // Show every installed atlas and animation, not just the newest delivery.
  order: [...index.animations.keys()],
  sheets: index.sheets,
  animations: Object.fromEntries([...index.animations].map(([id, animation]) => [id, {
    sheet: animation.sheet,
    indices: animation.indices,
    gazeRows: animation.gazeRows,
    optional: animation.optional,
    // Playback facts, so the GIFs keep the artist's own timings instead of guessing.
    fps: animation.fps,
    loop: animation.loop,
    frameDurationsMs: animation.frameDurationsMs,
  }])),
  // One loop per behaviour, used by the README. Steps name manifest animation ids, so a
  // GIF cannot show art the pet does not have; the English captions live here as data.
  gifs: [
    {
      file: 'session.gif',
      title: 'Follows the real session',
      steps: [
        { caption: 'Waits for your request', anims: ['waitingCall'] },
        { caption: 'Thinks it through', anims: ['think'] },
        { caption: 'Reads the request', anims: ['readEnter', 'readLoop'] },
        { caption: 'Composes the answer', anims: ['replyEnter', 'replyLoop'] },
        { caption: 'Works with a tool', anims: ['toolEnter', 'toolLoop'] },
        { caption: 'The job is done', anims: ['celebrate'] },
        { caption: 'Checks provider token counts when available', anims: ['walletCheck'] },
      ],
    },
    {
      file: 'waiting.gif',
      title: 'Waiting has top priority',
      steps: [
        { caption: 'An open request outranks everything', anims: ['waitingCall'] },
      ],
    },
    {
      file: 'working.gif',
      title: 'Shows the work phase',
      steps: [
        { caption: 'Thinking', anims: ['think'] },
        { caption: 'Reading the request', anims: ['readEnter', 'readLoop'] },
        { caption: 'Composing the answer', anims: ['replyEnter', 'replyLoop'] },
        { caption: 'Editing a file', anims: ['editEnter', 'editLoop'] },
      ],
    },
    {
      file: 'tools.gif',
      title: 'Holds the pose until the call ends',
      steps: [
        { caption: 'A command runs - no three-second timer', anims: ['toolEnter', 'toolLoop'] },
      ],
    },
    {
      file: 'wallet.gif',
      title: 'Token usage, when available',
      steps: [
        { caption: 'Input and output token counts, when available', anims: ['walletCheck'] },
      ],
    },
    {
      file: 'snack.gif',
      title: 'A snack after long work',
      steps: [
        { caption: 'Three to five minutes of work', anims: ['snack'] },
      ],
    },
    {
      file: 'sleep.gif',
      title: 'Sleeps when nothing happens',
      steps: [
        { caption: 'Settles into sleep', anims: ['sleepEnter', 'sleepBreath'] },
      ],
    },
    {
      file: 'problem.gif',
      title: 'Asks for your help',
      steps: [
        { caption: 'A calm signal, then a hold', anims: ['problem'] },
      ],
    },
  ],
}

const python = process.env.PYTHON ?? 'python3'
const check = process.argv.includes('--check')
const tempDir = check ? mkdtempSync(join(tmpdir(), 'big-fat-fish-girl-preview-')) : null

try {
  const renderPayload = check ? { ...payload, outputDir: tempDir } : payload
  let result = spawnSync(python, [join(root, 'scripts', 'preview.py')], {
    input: JSON.stringify(renderPayload),
    encoding: 'utf8',
  })
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.error?.message || 'preview.py failed\n')
    process.exitCode = result.status ?? 1
  } else if (!check) {
    process.stdout.write(result.stdout)
  } else {
    process.stdout.write('Rendered preview artwork to a temporary directory.\n')
    result = spawnSync(python, [
      join(root, 'scripts', 'compare-preview.py'),
      join(root, 'docs', 'preview'),
      tempDir,
    ], { encoding: 'utf8' })
    if (result.status !== 0) {
      process.stderr.write(result.stderr || result.error?.message || 'preview comparison failed\n')
      process.exitCode = result.status ?? 1
    } else {
      process.stdout.write(result.stdout)
    }
  }
} finally {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true })
}
