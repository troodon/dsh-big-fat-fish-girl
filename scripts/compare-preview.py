"""Compare preview images by decoded pixels and animation behavior."""
import os
import sys

from PIL import Image


def generated_files(directory):
    files = set()
    if not os.path.isdir(directory):
        return files

    for name in os.listdir(directory):
        path = os.path.join(directory, name)
        if os.path.isfile(path) and name.lower().endswith(('.png', '.gif')):
            files.add(name)

    gif_dir = os.path.join(directory, 'gifs')
    if os.path.isdir(gif_dir):
        for name in os.listdir(gif_dir):
            path = os.path.join(gif_dir, name)
            if os.path.isfile(path) and name.lower().endswith('.gif'):
                files.add(os.path.join('gifs', name))
    return files


def decode_image(path, animated):
    with Image.open(path) as image:
        size = image.size
        if not animated:
            return size, None, image.convert('RGBA').tobytes()

        loop = image.info.get('loop')
        frames = []
        for index in range(image.n_frames):
            image.seek(index)
            frame = image.convert('RGBA')
            frames.append((frame.size, image.info.get('duration'), frame.tobytes()))
        return size, loop, frames


def compare_file(relative_path, expected_path, actual_path):
    animated = relative_path.lower().endswith('.gif')
    try:
        expected = decode_image(expected_path, animated)
        actual = decode_image(actual_path, animated)
    except (OSError, ValueError, EOFError) as error:
        return [f'{relative_path}: could not decode image: {error}']

    errors = []
    if expected[0] != actual[0]:
        errors.append(f'{relative_path}: dimensions differ ({expected[0]} != {actual[0]})')

    if not animated:
        if expected[2] != actual[2]:
            errors.append(f'{relative_path}: RGBA pixels differ')
        return errors

    if expected[1] != actual[1]:
        errors.append(f'{relative_path}: loop count differs ({expected[1]} != {actual[1]})')
    expected_frames, actual_frames = expected[2], actual[2]
    if len(expected_frames) != len(actual_frames):
        errors.append(f'{relative_path}: frame count differs ({len(expected_frames)} != {len(actual_frames)})')

    for index, (expected_frame, actual_frame) in enumerate(zip(expected_frames, actual_frames)):
        if expected_frame[0] != actual_frame[0]:
            errors.append(f'{relative_path}: frame {index} dimensions differ')
        if expected_frame[1] != actual_frame[1]:
            errors.append(
                f'{relative_path}: frame {index} duration differs '
                f'({expected_frame[1]} != {actual_frame[1]})'
            )
        if expected_frame[2] != actual_frame[2]:
            errors.append(f'{relative_path}: frame {index} RGBA pixels differ')
    return errors


def compare_directories(expected_dir, actual_dir):
    expected_files = generated_files(expected_dir)
    actual_files = generated_files(actual_dir)
    errors = [f'missing generated preview: {name}' for name in sorted(expected_files - actual_files)]
    errors.extend(f'unexpected generated preview: {name}' for name in sorted(actual_files - expected_files))

    for name in sorted(expected_files & actual_files):
        errors.extend(compare_file(
            name,
            os.path.join(expected_dir, name),
            os.path.join(actual_dir, name),
        ))
    return errors


def main():
    if len(sys.argv) != 3:
        print('usage: compare-preview.py EXPECTED_DIR ACTUAL_DIR', file=sys.stderr)
        return 2

    errors = compare_directories(sys.argv[1], sys.argv[2])
    if errors:
        for error in errors:
            print(f'preview mismatch: {error}', file=sys.stderr)
        return 1

    print('Preview RGBA pixels and GIF frame timing/loop match.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
