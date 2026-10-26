# Generation notes

The character design sheet defined DeepSeek Chan's appearance: long deep-navy hair with
blue tips, blue whale-fin ears, a white frilled maid headband, a navy maid dress, a
whale-emblem apron and a small horizontal tail. Its lettering and page layout were excluded.

Each pose sequence used the character reference, a clean standing frame and the matching
original pose row as an action guide. Pose boards were cropped into transparent 192 × 256
PNGs, one per pose, and small disconnected fragments were removed. The original boards
remain in `boards/` for provenance. The editable source frames are in `frames/`; the
registered 256 × 256 frames and runtime atlases are generated from `registration.json`.

The runtime canvas is square. The four audited strips (`base-idle`, `story-reply-typing`,
`story-edit-file` and `story-think`) use explicit per-frame torso/support pivots, scale 1,
a shared x=128 axis and y=250 support line. Other frames get a 32 px transparent margin
on each side without resizing the artwork. The JSON pivots are the only registration inputs;
the build does not estimate scale from alpha area.

Run, jump, celebration, problem/crouch, and sleep-transition frames keep their authored
vertical arcs or pose changes rather than being forced to share a bounding-box size.

## Shared visual direction

Keep the same petite chibi girl throughout: long glossy deep navy hair fading to blue
tips, large blue eyes, a curled ahoge, white frilled maid headband, paired whale-fin ear
fins with blue bows, navy-and-white maid dress with gold piping, white apron with a small
blue whale emblem, white stockings, navy shoes, and a small horizontal-fluke tail. Use a
polished anime chibi finish. Preserve each action's pose and props while keeping the
character's scale and foot baseline consistent across its frames. Empty space is
transparent. Do not add scenery, text, labels, borders, watermarks, unrelated props, or
extra characters.

## Runtime frame mapping

| Atlas | Sequence directories in frame order |
| --- | --- |
| `spritesheet.png` | `base-idle`, `base-run-right`, `base-run-left`, `base-wave`, `base-jump`, `base-failed`, `base-waiting`, `base-running`, `base-review`, `base-gaze-00-07`, `base-gaze-08-15` |
| `spritesheet-idle.png` | `idle-stretch-yawn`, `idle-adjust-headband`, `idle-peek-around`, `idle-play-bubble`, `idle-sleep` |
| `spritesheet-work.png` | `work-process-input`, `work-compose-reply`, `work-use-tool`, `work-complete` |
| `spritesheet-food.png` | `food-eat-rice`, `food-sushi-tray`, `food-token-wallet` |
| `spritesheet-story.png` | `story-waiting-call`, `story-reply-typing`, `story-edit-file`, `story-think`, `story-reading`, `story-tool-use`, `story-problem`, `story-celebrate`, `story-restful-sleep`, `story-snack`, `story-wallet-check` |

The right-running strip is mirrored to produce the left-running strip. Atlas rows use
256 × 256 cells and the same sequence order as the shared runtime manifest.
