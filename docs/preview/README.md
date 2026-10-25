# Preview artwork

The atlas previews in this directory are **generated** from the shipped DeepSeek Chan skin;
none are drawn or retouched by hand. The overview includes every installed atlas and
animation. `captures/lines/` contains screenshots of the bundle running in the local preview
playground; real Harness captures are tracked separately in `captures/README.md`.

```sh
python3 -m pip install --requirement scripts/preview-requirements.txt
npm run preview:art        # regenerate committed files
node scripts/build-preview.mjs --check  # compare without modifying them
```

CI pins Pillow and compares decoded RGBA pixels plus GIF frame count, timing, and looping;
encoding-only differences do not fail the artwork gate.

## What is here

| File | What it is |
| --- | --- |
| `poses.png` | one strip per animation in all five shipped atlases |
| `gifs/<name>.gif` | captioned previews of selected animations from the story atlas — the set the README embeds |

The phrase samples under `captures/lines/` are automated browser captures; see
`captures/README.md` for the separate list of real Harness screenshots that are still wanted.

## The GIF set

`scripts/build-preview.mjs` declares the set as data: each GIF is a list of steps, and each
step names animation ids from the manifest plus an English caption. Rendering therefore
cannot silently substitute other art — an unknown animation id fails the run.

Looping animation keeps the frame timings from the manifest (including the artist's
per-frame durations on the `story` sheet); a step may override them with `durationMs`, and
a GIF that is removed from the list is deleted from this directory rather than left behind
as stale art.

## Provenance

`docs/preview/` stays on `main` for the README and is excluded from the installable `.tgz`.
Previews are rendered from the committed runtime atlases in `lib/skins/`; editable PNGs on
`art-source` are not needed to regenerate them.
