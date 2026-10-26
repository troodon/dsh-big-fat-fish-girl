# Artwork sources

This branch holds the editable DeepSeek Chan frames, original pose boards, registration data,
and atlas builder. It is not an installable Harness plugin. Use the `main` branch or the
[tagged releases](https://github.com/troodon/dsh-big-fat-fish-girl/releases) for the application.

- `assets/source/deepseek-chan/frames/`: immutable 192 x 256 source frames.
- `assets/source/deepseek-chan/boards/`: original pose boards kept for provenance.
- `assets/source/deepseek-chan/registration.json`: placement of every source frame.
- `assets/source/deepseek-chan/build-manifest.json`: source and output hashes.

Requires Python 3 and Pillow. From this branch root:

```sh
python3 assets/source/deepseek-chan/build-animation-atlases.py --verify
python3 assets/source/deepseek-chan/build-animation-atlases.py
```

Registered frames in `frames-256/` and runtime atlases in `lib/skins/` are generated outputs
and are not tracked on this branch. Commit updated runtime atlases and previews on `main`.
See the [main-branch source guide](https://github.com/troodon/dsh-big-fat-fish-girl/blob/main/assets/source/deepseek-chan/README.md)
to restore source frames into a development checkout without switching branches.

The character artwork is not covered by the code dedication. See [ASSET_LICENSE.md](ASSET_LICENSE.md).
