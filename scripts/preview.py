#!/usr/bin/env python3
"""Render README artwork from the sprite atlas.

Reads a JSON payload on stdin (see build-preview.mjs) and writes:

  docs/preview/poses.png      one strip per animation, straight from the atlas
  docs/preview/gaze.png       the 16 gaze directions with their angles
  docs/preview/idle.gif       the idle loop, animated
  docs/preview/gifs/*.gif     one loop per behaviour, captioned from the payload

Every picture is generated, never hand-kept, so it cannot drift from the art.
"""
import json
import os
import sys
from importlib.metadata import version

from PIL import Image, ImageDraw, ImageFont


EXPECTED_PILLOW = '11.3.0'
actual_pillow = version('Pillow')
if actual_pillow != EXPECTED_PILLOW:
    raise RuntimeError(
        f'preview generation requires Pillow {EXPECTED_PILLOW}; found {actual_pillow}. '
        'Install scripts/preview-requirements.txt to reproduce the committed artwork.'
    )

CARD = (247, 251, 255, 255)
INK = (25, 54, 101, 255)
MUTED = (110, 137, 175, 255)
SCALE = 0.6
PAD = 18
GAP = 8
LABEL_WIDTH = 150
MISSING = 'art not drawn yet'
# The behaviour GIFs are shown at the size the pet actually renders, with a title strip
# above and the current step's caption below.
GIF_SCALE = 0.75
TITLE_STRIP = 24
CAPTION_STRIP = 22
TITLE_LINE_HEIGHT = 14
CAPTION_LINE_HEIGHT = 12
TEXT_VERTICAL_PADDING = 8


def save_compact(image, path):
    """README artwork is flat colour and text: a palette keeps the file small."""
    image.quantize(colors=256, method=Image.FASTOCTREE, dither=Image.NONE).save(path, optimize=True)


def font(size):
    try:
        return ImageFont.load_default(size=size)
    except TypeError:  # Pillow < 10
        return ImageFont.load_default()


def load_sheets(payload):
    sheets = {}
    for sheet_id, sheet in payload['sheets'].items():
        path = os.path.join(payload['root'], payload['skinsDir'], sheet['file'])
        if not os.path.exists(path):
            continue
        sheets[sheet_id] = (Image.open(path).convert('RGBA'), sheet)
    return sheets


def cell(sheets, sheet_id, index, sheet_meta):
    image, _ = sheets[sheet_id]
    columns = sheet_meta['columns']
    row, column = divmod(index, columns)
    box = (
        column * sheet_meta['cellWidth'],
        row * sheet_meta['cellHeight'],
        (column + 1) * sheet_meta['cellWidth'],
        (row + 1) * sheet_meta['cellHeight'],
    )
    return image.crop(box)


def scaled(image, scale=SCALE):
    size = (max(1, round(image.width * scale)), max(1, round(image.height * scale)))
    return image.resize(size, Image.LANCZOS)


def build_poses(payload, sheets, out_dir):
    rows = []
    for anim_id in payload['order']:
        animation = payload['animations'].get(anim_id)
        if animation is None:
            continue
        if animation['sheet'] not in sheets:
            rows.append((anim_id, None, MISSING))
            continue
        sheet_meta = payload['sheets'][animation['sheet']]
        frames = [scaled(cell(sheets, animation['sheet'], index, sheet_meta)) for index in animation['indices']]
        rows.append((anim_id, frames, None))

    drawn = [row for row in rows if row[1]]
    if not drawn:
        return None

    cell_width = drawn[0][1][0].width
    cell_height = max(frame.height for _, frames, _ in drawn for frame in frames)
    strip = max(len(frames) * cell_width + (len(frames) - 1) * GAP for _, frames, _ in drawn)
    row_height = cell_height + GAP * 2
    width = PAD * 2 + LABEL_WIDTH + strip
    height = PAD * 2 + row_height * len(rows)

    canvas = Image.new('RGBA', (width, height), CARD)
    draw = ImageDraw.Draw(canvas)
    label_font = font(14)
    note_font = font(11)

    y = PAD
    for anim_id, frames, note in rows:
        if not frames:
            draw.text((PAD, y + 6), anim_id, font=label_font, fill=INK)
            draw.text((PAD, y + 26), note, font=note_font, fill=MUTED)
        else:
            draw.text((PAD, y + 6), anim_id, font=label_font, fill=INK)
            draw.text((PAD, y + 26), f'{len(frames)} frames', font=note_font, fill=MUTED)
            x = PAD + LABEL_WIDTH
            for frame in frames:
                canvas.alpha_composite(frame, (x, y))
                x += frame.width + GAP
        y += row_height

    path = os.path.join(out_dir, 'poses.png')
    save_compact(canvas, path)
    return path


def build_gaze(payload, sheets, out_dir):
    animation = payload['animations'].get('gaze')
    if animation is None or animation['sheet'] not in sheets:
        return None
    sheet_meta = payload['sheets'][animation['sheet']]
    gaze_rows = animation['gazeRows']
    columns = sheet_meta['columns']
    total = len(gaze_rows) * columns

    frames = []
    degrees = []
    for direction in range(total):
        row = gaze_rows[direction // columns]
        column = direction % columns
        frames.append(scaled(cell(sheets, animation['sheet'], row * columns + column, sheet_meta)))
        degrees.append(round(direction * (360 / total), 1))

    cell_width, cell_height = frames[0].size
    caption = 18
    width = PAD * 2 + columns * (cell_width + GAP) - GAP
    height = PAD * 2 + len(gaze_rows) * (cell_height + caption + GAP) - GAP
    canvas = Image.new('RGBA', (width, height), CARD)
    draw = ImageDraw.Draw(canvas)
    label_font = font(11)

    for position, frame in enumerate(frames):
        row = position // columns
        column = position % columns
        x = PAD + column * (cell_width + GAP)
        y = PAD + row * (cell_height + caption + GAP)
        canvas.alpha_composite(frame, (x, y))
        draw.text((x + 4, y + cell_height + 2), f'{degrees[position]}°', font=label_font, fill=MUTED)

    path = os.path.join(out_dir, 'gaze.png')
    save_compact(canvas, path)
    return path


def step_frames(payload, sheets, step):
    """One step of a feature GIF: its frames, their durations and its repeated caption."""
    frames = []
    durations = []
    for anim_id in step['anims']:
        animation = payload['animations'].get(anim_id)
        if animation is None:
            raise KeyError(f'unknown animation "{anim_id}"')
        if animation['sheet'] not in sheets:
            if animation.get('optional') is True:
                raise LookupError(f'art not drawn yet ({anim_id})')
            raise LookupError(f'sheet for "{anim_id}" is missing')
        sheet_meta = payload['sheets'][animation['sheet']]
        per_frame = animation.get('frameDurationsMs')
        for position, index in enumerate(animation['indices']):
            frames.append(scaled(cell(sheets, animation['sheet'], index, sheet_meta), GIF_SCALE))
            if per_frame and position < len(per_frame):
                durations.append(per_frame[position])
            else:
                durations.append(round(1000 / (animation.get('fps') or 4)))
    if step.get('durationMs'):
        durations = [step['durationMs']] * len(frames)
    return frames, durations


def save_gif(path, title, frames, durations, captions):
    """A card with the behaviour's name on top and the current step's caption below."""
    width = PAD * 2 + frames[0].width
    measure = ImageDraw.Draw(Image.new('RGB', (1, 1)))
    title_font = font(13)
    caption_font = font(11)
    title_lines = wrap_text(measure, title, width - PAD * 2, title_font)
    caption_lines = [wrap_text(measure, caption, width - PAD * 2, caption_font) for caption in captions]
    title_strip = max(TITLE_STRIP, TEXT_VERTICAL_PADDING + len(title_lines) * TITLE_LINE_HEIGHT)
    caption_strip = max(CAPTION_STRIP, TEXT_VERTICAL_PADDING + max(map(len, caption_lines)) * CAPTION_LINE_HEIGHT)
    height = title_strip + frames[0].height + caption_strip
    rendered = []
    for frame, lines in zip(frames, caption_lines):
        canvas = Image.new('RGBA', (width, height), CARD)
        canvas.alpha_composite(frame, (PAD, title_strip))
        draw = ImageDraw.Draw(canvas)
        for row, text in enumerate(title_lines):
            x = (width - draw.textlength(text, font=title_font)) / 2
            draw.text((x, 4 + row * TITLE_LINE_HEIGHT), text, font=title_font, fill=INK)
        for row, text in enumerate(lines):
            x = (width - draw.textlength(text, font=caption_font)) / 2
            y = title_strip + frames[0].height + 4 + row * CAPTION_LINE_HEIGHT
            draw.text((x, y), text, font=caption_font, fill=MUTED)
        # Keep quantization on the RGBA path: Pillow's RGB fast-octree reducer differs
        # across native builds even when the source pixels are identical.
        rendered.append(canvas.quantize(colors=256, method=Image.FASTOCTREE, dither=Image.NONE))
    rendered[0].save(path, save_all=True, append_images=rendered[1:],
                     duration=durations, loop=0, disposal=2, optimize=True)


def wrap_text(draw, text, max_width, face):
    """Wrap text by words, preserving every character in the generated previews."""
    lines = []
    current = ''
    for word in text.split():
        candidate = f'{current} {word}'.strip()
        if draw.textlength(candidate, font=face) <= max_width:
            current = candidate
            continue
        if current:
            lines.append(current)
            current = ''
        for character in word:
            candidate = current + character
            if current and draw.textlength(candidate, font=face) > max_width:
                lines.append(current)
                current = character
            else:
                current = candidate
    if current:
        lines.append(current)
    return lines


def build_feature_gifs(payload, sheets, out_dir):
    """Render one animated loop per behaviour into docs/preview/gifs/.

    Every step names manifest animation ids, so a GIF cannot show art the pet does not
    have; the English captions and the playback tweaks travel as data (payload['gifs']).
    """
    gifs = payload.get('gifs') or []
    if not gifs:
        return []
    gif_dir = os.path.join(out_dir, 'gifs')
    os.makedirs(gif_dir, exist_ok=True)
    keep = {gif['file'] for gif in gifs}

    written = []
    for gif in gifs:
        frames = []
        durations = []
        captions = []
        try:
            for step in gif['steps']:
                step_frames_, step_durations = step_frames(payload, sheets, step)
                frames.extend(step_frames_)
                durations.extend(step_durations)
                captions.extend([step['caption']] * len(step_frames_))
        except LookupError as error:
            print(f'skipped gifs/{gif["file"]}: {error}')
            continue
        if not frames:
            print(f'skipped gifs/{gif["file"]}: no frames')
            continue
        path = os.path.join(gif_dir, gif['file'])
        save_gif(path, gif['title'], frames, durations, captions)
        written.append(path)

    # A GIF that is no longer in the list would linger and read as still-current art.
    for name in sorted(os.listdir(gif_dir)):
        if name.endswith('.gif') and name not in keep:
            os.remove(os.path.join(gif_dir, name))
            print(f'removed stale gifs/{name}')
    return written


def build_idle_gif(payload, sheets, out_dir):
    animation = payload['animations'].get('idle')
    if animation is None or animation['sheet'] not in sheets:
        return None
    sheet_meta = payload['sheets'][animation['sheet']]
    frames = []
    for index in animation['indices']:
        frame = cell(sheets, animation['sheet'], index, sheet_meta)
        card = Image.new('RGBA', (frame.width + PAD, frame.height + PAD), CARD)
        card.alpha_composite(frame, (PAD // 2, PAD // 2))
        # Match the static previews' RGBA quantizer; adaptive conversion differed by platform.
        frames.append(card.quantize(colors=256, method=Image.FASTOCTREE, dither=Image.NONE))

    path = os.path.join(out_dir, 'idle.gif')
    frames[0].save(path, save_all=True, append_images=frames[1:], duration=333, loop=0, disposal=2)
    return path


def main():
    payload = json.load(sys.stdin)
    out_dir = payload.get('outputDir') or os.path.join(payload['root'], 'docs', 'preview')
    os.makedirs(out_dir, exist_ok=True)
    sheets = load_sheets(payload)
    if not sheets:
        print('no sheets found — nothing to preview')
        return 0
    for builder, stale_name in (
        (build_poses, 'poses.png'),
        (build_gaze, 'gaze.png'),
        (build_idle_gif, 'idle.gif'),
    ):
        path = builder(payload, sheets, out_dir)
        if path:
            print(f'wrote {os.path.relpath(path, payload["root"])}')
        else:
            stale_path = os.path.join(out_dir, stale_name)
            if os.path.exists(stale_path):
                os.remove(stale_path)
                print(f'removed stale {os.path.relpath(stale_path, payload["root"])}')
    for path in build_feature_gifs(payload, sheets, out_dir):
        print(f'wrote {os.path.relpath(path, payload["root"])}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
