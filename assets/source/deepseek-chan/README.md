# DeepSeek Chan sprite assets

The immutable editable inputs are transparent PNGs in `frames/<sequence>/frame-NN.png`.
They are 192 × 256 RGBA cells and are never rewritten by the build. `registration.json`
records an explicit source anchor, uniform scale and offset for every frame. The square
registered frames are generated separately in `frames-256/`.

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

See `PROMPTS.md` for generation and frame-extraction provenance.
