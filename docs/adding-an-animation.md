# Adding an animation

Animations are data-driven. Add art to an installed skin and describe it in
[`lib/animation/manifest.mjs`](../lib/animation/manifest.mjs); then reference it from a state,
act, scene or tool phase as appropriate. A data-only animation needs no renderer or UI change.

## Skins

The runtime art is organised as **skins**. The package currently ships one skin,
`deepseek-chan`, titled **DeepSeek Chan (Big Fat Fish Girl)**. Its complete atlas set is in
`lib/skins/deepseek-chan/`:

```
lib/skins/deepseek-chan/
  skin.json
  spritesheet.png          the base atlas
  spritesheet-idle.png     idle antics
  spritesheet-work.png     working poses
  spritesheet-food.png     snacks and the wallet
  spritesheet-story.png    authored story animations
```

Editable PNGs live on the separate `art-source` branch, not on `main`. Follow the
[source guide](../assets/source/deepseek-chan/README.md) to restore the pinned `frames/`
snapshot into a development checkout. Original action-guide boards are preserved there too.
`registration.json` and the builder stay on `main`; the page loads only the ready-made
atlases in `lib/skins/deepseek-chan/`.

The active skin is a normal setting (`skin` in the plugin Config). The host lists the
installed skins (`GET /big-fat-fish-girl/v1/skins`), serves each sheet per skin
(`/skin/<id>/<file>`), and publishes the selection in every snapshot. Sheet URLs include
the PNG's SHA-256, so immutable browser caches cannot reuse old pixels after an atlas is
rebuilt under the same filename. `npm run build` and `npm run build:desktop` regenerate
the revision map; `npm run verify` checks it against every installed skin. The pages
reload their sheets when the skin changes; the desktop shell re-decodes its click-through
atlas. The engine supports additional skin folders, but only DeepSeek Chan is currently
included in the package.

## 1. Draw the frames

Keep the established character design and scale consistent across frames. Use genuine
transparency, leave room for the pose and props inside each cell, and avoid per-frame
cropping or recentering. Keep props stable through loops; show them entering and leaving in
separate transitions when the scene supports them. Do not bake text or unobserved numeric
values into the art; the application supplies user-facing text and only displays actual
provider token counts.

A sheet is a grid of cells:

- every cell is the same size (`cellWidth` x `cellHeight`),
- frames are laid out row by row, left to right,
- the file is a PNG with an alpha channel, one cell per pose,
- keep the character anchored inside the cell: the engine copies whole cells, it does
  not trim or recentre them.

Every runtime sheet shares one square cell: **256 x 256** (`CELL` in the manifest).
Transparent side margins provide room for long hair, arms and props without resizing the
artwork. The size setting retains its previous meaning: the square canvas side is
`size * 256 / 192`, so the visible character keeps the same screen scale.

DeepSeek Chan uses five sheets: `spritesheet.png` (8 × 11), `spritesheet-idle.png`
(6 × 5), `spritesheet-work.png` (6 × 4), `spritesheet-food.png` (6 × 3), and
`spritesheet-story.png` (9 × 11). Every cell is 256 × 256 RGBA. The source builder
[`assets/source/deepseek-chan/build-animation-atlases.py`](../assets/source/deepseek-chan/build-animation-atlases.py)
registers the immutable frames and packs those five runtime atlases; it does not rewrite
source art.

`optional: true` means "the art may not exist yet": the engine hides every animation that
uses this sheet, and the asset gate prints `skip` instead of failing. Drop the flag once
the art is committed, and the gate starts checking the file dimensions.

## 2. Describe the animation

```js
{ id: 'eatRice', sheet: 'food', row: 0, frames: 6, fps: 5, loop: true }
```

For a timed animation, add its frame indices and authored durations to the manifest entry.
The story atlas packs those animation strips by row; the manifest remains the source of truth
for playback order, loop behavior, hold frames and timings.

| Field | Meaning |
| --- | --- |
| `id` | unique name; this is what acts and states refer to |
| `sheet` | key from `sheets` |
| `row` + `frames` | play the first `frames` cells of that row |
| `frames: [12, 13, 15, 13]` | or an explicit list of grid indices (row-major) for ping-pong or hand-picked sequences |
| `fps` | playback rate |
| `loop` | `false` for a one-off pose that holds its last frame |
| `gazeRows` | only for the gaze animation: which rows hold the 16 directions |
| `staticFrame` | the readable anchor shown under reduced motion (default 0) |
| `holdFrame` | the frame a scene holds when its loop is paused (for future use) |
| `frameDurationsMs` | authored per-frame timings (one positive number per frame); when present they replace `fps`, which lets a strip end with a long calm hold — the pilot strips use this |
| `optional` | `true` while the art is still being drawn; the engine skips it and the gate reports "skip" |

### Scenes and state fallbacks

Long actions are scenes, not bare animations. A scene points at the strip that plays while
the phase lasts, plus the classic animation used if that strip is unavailable:

```js
scenes: {
  compose: { loop: 'replyTyping', fallback: 'composeReply' },
}
states: {
  waiting: { anim: 'waitingCall', fallback: 'waiting' },
}
```

`engine.playScene(id, ms)` plays the loop for the requested time; segments (`enter`/`exit`/
`micros`) are still supported for deliveries that ship them. A state shows its `fallback`
when the new animation is unavailable (its sheet failed to load, an older package), so the
pet is never left undrawn. `validateManifest` checks every reference, so a typo fails
`npm run verify`.

## 3. Wire it into behaviour

States are what the session drives; acts are the random ones:

```js
states: { idle: { anim: 'idle' }, running: { anim: 'running' }, /* … */ },
acts: {
  hover: [{ anim: 'wave', weight: 4, ms: 1200 }],
  idle:  [{ anim: 'eatRice', weight: 3, ms: 3200 }],
}
```

`weight` is relative (a 3 is three times as likely as a 1) and `ms` is how long one
outburst lasts. Act groups are copied through generically, so a brand-new group
(`working`, `night`, …) needs nothing but a manifest entry.

## Reacting to tools

`toolActs` maps a tool phase to an animation:

```js
toolActs: { reading: 'processInput', writing: 'composeReply', commanding: 'useTool' }
```

The phases are classified in [`lib/host/host-adapter.mjs`](../lib/host/host-adapter.mjs)
from the raw tool name; only the phase travels to the browser. `npm run verify` rejects a
phase that points at an animation that does not exist. An idle act only starts when nothing
else is happening, and every real event pushes the timer back.

## 4. Check it

```sh
npm run build          # rebuild skin data and lib/client.js
npm run build:desktop  # rebuild desktop/pet.html
npm run preview:art    # regenerate docs/preview (requires Pillow)
npm run check          # assets, generated bundles and tests
```

`npm run verify` is the gate to trust: it catches unknown sheets, duplicate ids, rows
outside the sheet, frame indices out of range, states or acts referencing an animation
that does not exist, non-positive weights, and PNG dimensions that disagree with the
declared grid.

## Before committing

- [ ] the art files are committed under `lib/skins/<skin>/`, PNG with alpha, uniform cells
- [ ] the manifest entry is added, with `optional` removed once the art is in
- [ ] the animation is reachable: referenced by a `state` or listed in `acts`
- [ ] the idle act is short enough not to be annoying (2–4 s reads best)
- [ ] `npm run check` passes
- [ ] `docs/preview` is regenerated and committed
