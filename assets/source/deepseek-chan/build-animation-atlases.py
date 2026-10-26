#!/usr/bin/env python3
"""Build square runtime atlases from immutable animation sources.

Inputs are the immutable frames under assets/source/deepseek-chan/frames plus
registration.json. Outputs are registered 256x256 frames and the five DeepSeek Chan atlases.

Requires Pillow. Run from the repository root:
    python3 assets/source/deepseek-chan/build-animation-atlases.py
    python3 assets/source/deepseek-chan/build-animation-atlases.py --verify
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import shutil
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageChops


ROOT = Path(__file__).resolve().parents[3]
SOURCE_ROOT = ROOT / "assets/source/deepseek-chan"
FRAME_ROOT = SOURCE_ROOT / "frames"
REGISTRATION_PATH = SOURCE_ROOT / "registration.json"
REGISTERED_ROOT = SOURCE_ROOT / "frames-256"
DEEPSEEK_OUT = ROOT / "lib/skins/deepseek-chan"
BUILD_MANIFEST = SOURCE_ROOT / "build-manifest.json"

CELL = (256, 256)
SOURCE_CELL = (192, 256)
TARGET_ANCHOR = (128, 250)
ATLAS_LAYOUTS = {
    "spritesheet.png": (8, 11, (
        "base-idle", "base-run-right", "base-run-left", "base-wave", "base-jump",
        "base-failed", "base-waiting", "base-running", "base-review",
        "base-gaze-00-07", "base-gaze-08-15",
    )),
    "spritesheet-idle.png": (6, 5, (
        "idle-stretch-yawn", "idle-adjust-headband", "idle-peek-around",
        "idle-play-bubble", "idle-sleep",
    )),
    "spritesheet-work.png": (6, 4, (
        "work-process-input", "work-compose-reply", "work-use-tool", "work-complete",
    )),
    "spritesheet-food.png": (6, 3, (
        "food-eat-rice", "food-sushi-tray", "food-token-wallet",
    )),
    "spritesheet-story.png": (9, 11, (
        "story-waiting-call", "story-reply-typing", "story-edit-file", "story-think",
        "story-reading", "story-tool-use", "story-problem", "story-celebrate",
        "story-restful-sleep", "story-snack", "story-wallet-check",
    )),
}


def digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def pngs_under(*roots: Path) -> list[Path]:
    return sorted(path for root in roots for path in root.rglob("*.png"))


def registration_data() -> dict:
    data = json.loads(REGISTRATION_PATH.read_text(encoding="utf-8"))
    if data.get("schemaVersion") != 1:
        raise SystemExit("registration.json: unsupported schemaVersion")
    if data.get("cell") != {"width": CELL[0], "height": CELL[1]}:
        raise SystemExit("registration.json: output cell must be 256x256")
    if data.get("sourceCell") != {"width": SOURCE_CELL[0], "height": SOURCE_CELL[1]}:
        raise SystemExit("registration.json: source cell must be 192x256")
    if data.get("targetAnchor") != {"x": TARGET_ANCHOR[0], "y": TARGET_ANCHOR[1]}:
        raise SystemExit("registration.json: unexpected target anchor")

    actual_sequences = {path.name for path in FRAME_ROOT.iterdir() if path.is_dir()}
    declared_sequences = set(data.get("sequences", {}))
    if actual_sequences != declared_sequences:
        missing = sorted(actual_sequences - declared_sequences)
        extra = sorted(declared_sequences - actual_sequences)
        raise SystemExit(f"registration sequence mismatch; missing={missing}, extra={extra}")

    for sequence in sorted(actual_sequences):
        source_files = sorted(path.name for path in (FRAME_ROOT / sequence).glob("frame-*.png"))
        records = data["sequences"][sequence].get("frames", [])
        if [item.get("file") for item in records] != source_files:
            raise SystemExit(f"{sequence}: registration frame list does not match the immutable sources")
        for item in records:
            for key in ("ax", "ay", "s", "mx", "my"):
                if not isinstance(item.get(key), (int, float)):
                    raise SystemExit(f"{sequence}/{item['file']}: {key} must be numeric")
            if item["s"] <= 0:
                raise SystemExit(f"{sequence}/{item['file']}: scale must be positive")
    return data


def transform_frame(frame: Image.Image, registration: dict) -> Image.Image:
    """Apply the documented source-anchor to target-anchor affine transform."""
    scale = float(registration["s"])
    ax, ay = float(registration["ax"]), float(registration["ay"])
    mx, my = float(registration["mx"]), float(registration["my"])
    tx, ty = TARGET_ANCHOR
    source_bounds = frame.getchannel("A").getbbox()
    if source_bounds is None:
        raise SystemExit("registration input frame is empty")
    x0, y0, x1, y1 = source_bounds
    mapped_bounds = (
        tx + scale * (x0 - ax) + mx,
        ty + scale * (y0 - ay) + my,
        tx + scale * (x1 - 1 - ax) + mx,
        ty + scale * (y1 - 1 - ay) + my,
    )
    if mapped_bounds[0] < 0 or mapped_bounds[1] < 0 or mapped_bounds[2] > CELL[0] - 1 or mapped_bounds[3] > CELL[1] - 1:
        raise SystemExit(f"registration would crop art: source={source_bounds}, mapped={mapped_bounds}")
    inverse = 1.0 / scale
    # Pillow maps each output coordinate back to its source coordinate.
    coefficients = (
        inverse, 0.0, ax - (tx + mx) * inverse,
        0.0, inverse, ay - (ty + my) * inverse,
    )
    premultiplied = frame.convert("RGBa")
    result = premultiplied.transform(
        CELL,
        Image.Transform.AFFINE,
        coefficients,
        resample=Image.Resampling.BICUBIC,
        fillcolor=(0, 0, 0, 0),
    ).convert("RGBA")
    bounds = result.getchannel("A").getbbox()
    if bounds is None:
        raise SystemExit("registration produced an empty frame")
    return result


def build_registered_frames(output_root: Path, data: dict) -> dict[str, list[Image.Image]]:
    output_root.mkdir(parents=True, exist_ok=True)
    sequences: dict[str, list[Image.Image]] = {}
    for sequence in sorted(data["sequences"]):
        records = data["sequences"][sequence]["frames"]
        sequence_out = output_root / sequence
        sequence_out.mkdir(parents=True, exist_ok=True)
        frames = []
        for record in records:
            source = FRAME_ROOT / sequence / record["file"]
            with Image.open(source) as opened:
                frame = opened.convert("RGBA")
            if frame.size != SOURCE_CELL:
                raise SystemExit(f"{source}: expected {SOURCE_CELL}, got {frame.size}")
            output = transform_frame(frame, record)
            output.save(sequence_out / record["file"], format="PNG", optimize=False)
            frames.append(output)
        sequences[sequence] = frames
    return sequences


def pack_deepseek(output_dir: Path, frames: dict[str, list[Image.Image]]) -> dict[str, Image.Image]:
    output_dir.mkdir(parents=True, exist_ok=True)
    atlases = {}
    for filename, (columns, rows, sequence_names) in ATLAS_LAYOUTS.items():
        atlas = Image.new("RGBA", (columns * CELL[0], rows * CELL[1]), (0, 0, 0, 0))
        for row, sequence in enumerate(sequence_names):
            if sequence not in frames:
                raise SystemExit(f"{filename}: missing source sequence {sequence}")
            sequence_frames = frames[sequence]
            if len(sequence_frames) > columns:
                raise SystemExit(f"{sequence}: {len(sequence_frames)} frames exceed {columns} columns")
            for column, frame in enumerate(sequence_frames):
                atlas.alpha_composite(frame, (column * CELL[0], row * CELL[1]))
        atlas.save(output_dir / filename, format="PNG", optimize=False)
        atlases[filename] = atlas
    return atlases



def packed_cell_matches(frame: Image.Image, atlas: Image.Image, column: int, row: int) -> bool:
    packed = atlas.crop((column * CELL[0], row * CELL[1], (column + 1) * CELL[0], (row + 1) * CELL[1]))
    alpha_difference = ImageChops.difference(frame.getchannel("A"), packed.getchannel("A"))
    if alpha_difference.getbbox() is not None:
        return False
    visible = ImageChops.lighter(frame.getchannel("A"), packed.getchannel("A"))
    visible = visible.point(lambda value: 255 if value > 0 else 0)
    color_difference = ImageChops.difference(frame.convert("RGB"), packed.convert("RGB"))
    return ImageChops.multiply(color_difference, visible.convert("RGB")).getbbox() is None


def output_hashes(directory: Path) -> dict[str, str]:
    return {str(path.relative_to(directory)): digest(path) for path in sorted(directory.rglob("*.png"))}


def build_to(directory: Path, registration: dict) -> tuple[dict[str, str], dict[str, list[Image.Image]]]:
    frames_dir = directory / "frames-256"
    deepseek_dir = directory / "deepseek-chan"
    frames = build_registered_frames(frames_dir, registration)
    deepseek_atlases = pack_deepseek(deepseek_dir, frames)

    # Every image, including all runtime cells, must be a square 256px cell.
    for filename, atlas in deepseek_atlases.items():
        columns, rows, sequence_names = ATLAS_LAYOUTS[filename]
        if atlas.size != (columns * CELL[0], rows * CELL[1]):
            raise SystemExit(f"{filename}: incorrect packed dimensions {atlas.size}")
        for row, sequence in enumerate(sequence_names):
            for column, frame in enumerate(frames[sequence]):
                if not packed_cell_matches(frame, atlas, column, row):
                    raise SystemExit(f"{filename}: cell ({column},{row}) differs from {sequence}/frame-{column:02}.png")
    return output_hashes(directory), frames


def source_hashes() -> dict[str, str]:
    inputs = pngs_under(FRAME_ROOT)
    inputs.append(REGISTRATION_PATH)
    return {str(path.relative_to(ROOT)): digest(path) for path in sorted(inputs)}


def verify_repeatability(registration: dict) -> dict:
    before = source_hashes()
    with tempfile.TemporaryDirectory(prefix="bffg-animation-a-") as first_dir, tempfile.TemporaryDirectory(prefix="bffg-animation-b-") as second_dir:
        first_hashes, _ = build_to(Path(first_dir), registration)
        second_hashes, _ = build_to(Path(second_dir), registration)
    if first_hashes != second_hashes:
        changed = sorted(key for key in set(first_hashes) | set(second_hashes) if first_hashes.get(key) != second_hashes.get(key))
        raise SystemExit(f"repeat build differs: {changed}")
    if source_hashes() != before:
        raise SystemExit("an immutable input changed during the build")
    return {"sourcesUnchanged": True, "repeatable": True, "outputPngCount": len(first_hashes), "outputs": first_hashes}


def install_outputs(directory: Path) -> None:
    frame_stage = directory / "frames-256"
    if REGISTERED_ROOT.exists():
        shutil.rmtree(REGISTERED_ROOT)
    shutil.move(str(frame_stage), str(REGISTERED_ROOT))
    DEEPSEEK_OUT.mkdir(parents=True, exist_ok=True)
    for source in (directory / "deepseek-chan").glob("*.png"):
        shutil.move(str(source), str(DEEPSEEK_OUT / source.name))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--verify", action="store_true", help="build twice in temporary folders and compare hashes")
    args = parser.parse_args()
    registration = registration_data()
    if args.verify:
        result = verify_repeatability(registration)
        print(f"verify-animation-atlases: OK — {result['outputPngCount']} PNG hashes repeat; immutable inputs unchanged")
        return 0

    before = source_hashes()
    with tempfile.TemporaryDirectory(prefix="bffg-animation-build-") as temporary:
        stage = Path(temporary)
        output_map, _ = build_to(stage, registration)
        install_outputs(stage)
    after = source_hashes()
    if before != after:
        raise SystemExit("an immutable input changed during the build")
    manifest = {
        "cell": {"width": CELL[0], "height": CELL[1]},
        "sourceCell": {"width": SOURCE_CELL[0], "height": SOURCE_CELL[1]},
        "targetAnchor": {"x": TARGET_ANCHOR[0], "y": TARGET_ANCHOR[1]},
        "sourceSha256": before,
        "outputSha256": output_map,
        "outputFrames": "assets/source/deepseek-chan/frames-256/",
        "runtimeAtlases": ["lib/skins/deepseek-chan/"],
    }
    BUILD_MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"built registered frames in {REGISTERED_ROOT.relative_to(ROOT)}")
    print("built five 256x256-cell atlases for deepseek-chan")
    print(f"wrote {BUILD_MANIFEST.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, ValueError, KeyError, TypeError) as error:
        print(f"build-animation-atlases: {error}", file=sys.stderr)
        sys.exit(1)
