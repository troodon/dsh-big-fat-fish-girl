# DeepSeek Chan sprite assets

The `main` branch contains the runtime atlases, builder, registration data and build hashes.
Editable PNGs and original pose boards live on the separate
[`art-source` branch](https://github.com/troodon/dsh-big-fat-fish-girl/tree/art-source).
They are not needed to install the plugin, build the app, run the tests or render previews.

The editable inputs are transparent 192 × 256 RGBA PNGs in `frames/<sequence>/frame-NN.png`.
The build never rewrites them. `registration.json` records an explicit source anchor, uniform
scale and offset for every frame. Square registered frames are generated in `frames-256/`
and are not tracked on either branch.

The runtime format is **256 × 256 RGBA per cell**. DeepSeek Chan is the only installed skin;
its five atlases retain the shared manifest's frame counts, rows and ordering:

| Runtime atlas | Grid | Pixel size | Rows |
| --- | ---: | ---: | --- |
| `spritesheet.png` | 8 × 11 | 2048 × 2816 | idle, run right, mirrored run left, wave, jump, failed, waiting, running, review, gaze 0–7, gaze 8–15 |
| `spritesheet-idle.png` | 6 × 5 | 1536 × 1280 | stretch/yawn, adjust headband, peek, bubble, sleep |
| `spritesheet-work.png` | 6 × 4 | 1536 × 1024 | process input, compose reply, use tool, complete |
| `spritesheet-food.png` | 6 × 3 | 1536 × 768 | eat rice, sushi tray, token wallet |
| `spritesheet-story.png` | 9 × 11 | 2304 × 2816 | waiting call, reply typing, edit file, think, reading, tool use, problem, celebrate, restful sleep, snack, wallet check |

The first ten story rows use six frames each. The last row (`walletCheck`) uses nine.
Unused cells are transparent. `base-run-left` is mirrored from `base-run-right` in the
source set.

## Restore the editable sources

From a development checkout of `main`, fetch the source snapshot matching the committed
registration data and build manifest. Restore only if `frames/` is absent, or back up your
local edits first; `git restore` replaces existing source files.

```sh
git fetch --depth=1 https://github.com/troodon/dsh-big-fat-fish-girl.git 63d31851402f9056fa770be3cd5a70ba646a213a
git restore --source=FETCH_HEAD --worktree -- assets/source/deepseek-chan/frames
```

This downloads the source branch only when requested. It does not switch branches, stage
files or add artwork to `main`; restored PNGs are ignored by Git. The snapshot also retains
`boards/` for provenance. Restore them separately if needed:

```sh
git restore --source=FETCH_HEAD --worktree -- assets/source/deepseek-chan/boards
```

A full clone can still download artwork from other branches or old tags. To clone only the
current application snapshot, use `--depth 1 --single-branch --branch main --no-tags`.

## Registration and build

`registration.json` targets the torso axis x=128 and support line y=250. `base-idle`,
`story-reply-typing`, `story-edit-file` and `story-think` use per-frame body/support
anchors with scale 1; movement in the keyboard, hands, face and authored poses remains.
Other sequences are marked `technical-transfer`: x=96 maps to x=128, which adds 32
transparent pixels to each side without resizing or recentering the drawing vertically.

The build creates all five runtime atlases directly from these immutable registered frames.
DeepSeek Chan is the only shipped character; no draft skin or alternate character is packaged.

Requires Python 3 and Pillow. From the repository root:

```sh
python3 assets/source/deepseek-chan/build-animation-atlases.py
```

To verify that two builds produce identical PNG hashes and leave all source images
unchanged:

```sh
python3 assets/source/deepseek-chan/build-animation-atlases.py --verify
```

`build-manifest.json` records SHA-256 hashes for every input and generated PNG.

See `PROMPTS.md` for generation and frame-extraction provenance. When changing the artwork,
commit editable PNGs on `art-source`, then update this source snapshot pin, registration data,
build manifest, runtime atlases and previews on `main`. Do not merge the source branch into
`main`.
