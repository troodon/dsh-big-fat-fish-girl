# Install on macOS

Big Fat Fish Girl needs the Harness plugin and a separate macOS shell app. Use a verified
prebuilt app attached to the selected release, or build locally from that release's pinned
source tag if no matching app archive is available. Use the same tag for the shell and plugin
package.

## Before you start

- Confirm the release tag and route with the user. Never mix plugin and app versions.
- Do not read prompts, responses, tool arguments, session titles, or credentials. Preserve
  the Harness profile; change only the plugin's `shellPath` setting if needed.
- Ask before installing tools, building from source, replacing an existing app, or restarting
  Harness. Do not request an admin password or use an automatic `sudo` installer.
- Prefer `~/Applications` for the app. Do not overwrite an existing install without consent.

## Choose the release and verify the plugin package

Use a published `v`-prefixed tag matching the package version. A manual workflow run creates
CI artifacts, not a GitHub release. Use only assets attached to the selected tagged release.
Download the plugin `.tgz` from that release and verify it against `SHA256SUMS` when provided.
This runtime-only package excludes demos and source art. Do not use GitHub's larger **Source
code** archive as the plugin installer.
For a source build, use the `.tgz` from the same tag. If the package is missing, stop rather
than substitute a registry package or another version.

For a prebuilt app, download the matching CPU archive attached to the release and verify it
against `SHA256SUMS` before installing either file. Run `shasum -a 256 <downloaded-file>`
and compare the full hash; use the archive's `.sha256` file as an additional check when
provided. A checksum detects accidental changes, not publisher identity or a trusted GitHub
signature.

## Route A: install the prebuilt app

1. Check the Mac's CPU:

   ```sh
   uname -m
   ```

   Choose `macos-arm64` for `arm64` or `macos-x64` for `x86_64`. Stop if the architecture is
   unexpected.

2. Extract the verified zip into a fresh, empty staging directory with `ditto`, which
   preserves the app's executable permissions:

   ```sh
   mkdir -p "$HOME/Downloads/bffg-stage"
   ditto -x -k "$HOME/Downloads/big-fat-fish-girl-shell-<version>-macos-<arch>.zip" "$HOME/Downloads/bffg-stage"
   codesign --verify --deep --strict "$HOME/Downloads/bffg-stage/Big Fat Fish Girl Shell.app"
   ```

   `codesign --verify` checks signature integrity only. Release archives are ad-hoc signed,
   not Developer ID-signed or notarized; this is not a trusted GitHub signature.

3. After confirming the destination is absent, copy the app to
   `~/Applications/Big Fat Fish Girl Shell.app`. The shell discovers this path as well as
   `/Applications`; if it is not found, set `shellPath` in the plugin settings to the app or
   executable path. Do not edit the full Harness config.

4. Gatekeeper may block the downloaded app on first launch. If it does, explain the warning
   and let the user decide whether to use **System Settings → Privacy & Security → Open
   Anyway**, following [Apple's instructions](https://support.apple.com/en-us/102445). Never
   remove quarantine attributes, disable Gatekeeper, or silently re-sign the download. Offer
   the source-build route if the user prefers or policy blocks the app.

## Route B: build from the pinned source

This route works when no app zip is available, or if the user prefers a local build. Clone
the same published tag; do not use the default branch or the npm package, which has no Rust
sources. Requirements are macOS, Xcode Command Line Tools, Rust, and Tauri CLI 2.12.1. See
[Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) and [Rust installation](https://rustup.rs/).

The first build and dependency downloads can take time and use network and disk space. Ask
before installing missing tools or starting the build. No paid Apple Developer account is
required, but managed Macs may impose their own policies.

If Tauri CLI 2.12.1 is missing, ask before installing the pinned version:

```sh
cargo install tauri-cli --version 2.12.1 --locked
```

From a suitable parent directory, replace `<published-tag>` with the exact release tag:

```sh
git clone --branch <published-tag> https://github.com/troodon/dsh-big-fat-fish-girl.git
cd dsh-big-fat-fish-girl/desktop/tauri
cargo tauri build --ci --bundles app -- --locked
```

The app is created at `desktop/tauri/target/release/bundle/macos/Big Fat Fish Girl Shell.app`
relative to the repository root. After the build, copy it to `~/Applications/Big Fat Fish Girl
Shell.app` only if the destination is absent or the user approves replacing it. The build
may still be blocked by managed-Mac policy.

## Install the verified plugin and finish

Only after package checks and the selected app route are complete, install the verified
`.tgz` into Harness's **desktop** profile with the CLI bundled in Harness, not a separate
`npx`/npm CLI. Adjust the CLI path if Harness is installed outside `/Applications`:

```sh
"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" plugin --profile desktop add /absolute/path/to/big-fat-fish-girl-<version>.tgz
```

Make sure **Start with Harness** is on. Harness passes its current dynamic page URL when it
starts the shell; ask before restarting Harness or interrupting active work. If the shell is
not found, change only `shellPath` in the plugin settings.

Verify the app actually starts and the pet is visible. With the user's help, check that
activity updates across more than one open chat and while Harness is minimized. Do not inspect chat
contents. A checksum, successful build, or signature check alone does not prove the GUI or
Harness integration works. Report the route and release used, what was verified, and any
Gatekeeper or policy issue.
