# macOS desktop app

The tagged-release workflow builds ad-hoc signed macOS app archives for arm64 and x64,
with a plugin package and checksums. Use assets attached to the selected release, or build
from the same source tag if no matching app archive is available. The [macOS install
guide](../../docs/INSTALL.md) covers both routes and the matching plugin.

## Build and use

Requirements: macOS, Xcode Command Line Tools, Rust, and Tauri CLI v2. Follow the official
[Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/) for platform tools and
[Rust's installation instructions](https://rustup.rs/) to install Rust. A local build does
not require a paid Apple Developer account, author-provided Developer ID signature, or
notarization. Tool installation and the build may still need to comply with your
organization's device policies.

To build from a release source tag, check out the tag matching the plugin version. Replace
`<published-tag>` below with that tag. Use Tauri CLI 2.12.1; if it is missing, follow the
[install guide](../../docs/INSTALL.md) before building.

```sh
git clone --branch <published-tag> https://github.com/troodon/dsh-big-fat-fish-girl.git
cd dsh-big-fat-fish-girl/desktop/tauri
cargo tauri build --ci --bundles app -- --locked
```

The resulting app is at `target/release/bundle/macos/Big Fat Fish Girl Shell.app` relative
to `desktop/tauri`. The shell uses the system WebView. For app placement, `shellPath`, and
first-launch checks, follow the [install guide](../../docs/INSTALL.md).

The tested macOS build is arm64; Intel is untested. Windows is untested. Linux builds are
not available.

Install the Harness plugin separately. With the shell available, **Start with Harness** is
enabled by default: the plugin starts the shell and stops only the process it started. A
shell already running is not owned or stopped by the plugin. Disable the setting to manage
the shell manually.

The pet is transparent, non-activating, and stays above ordinary windows while Harness is
inactive. It shows activity across all chats. Clicking its navigation bubble brings
Harness forward, where it shows its last-open chat. Full-screen app coverage is not
promised.

## Windows build

Windows is untested. These instructions are for development; a successful build does not
establish runtime support.

To build on Windows, install Rust's MSVC toolchain, C++ Build Tools, the Windows SDK and
Tauri CLI v2 following the [prerequisites](https://v2.tauri.app/start/prerequisites/).
From `desktop/tauri`, run:

```sh
cargo tauri build --bundles nsis
```

The installer is written to `target/release/bundle/nsis/` and installs for the current user
under `%LOCALAPPDATA%\Big Fat Fish Girl Shell`, which the Harness plugin detects. Install
the plugin first. Leave the installer's **Run** checkbox unchecked, then restart Harness
with **Start with Harness** enabled. Harness will start the shell and pass its current page
URL, including the dynamic port. For a custom location, set `shellPath` to the executable's
absolute path.

The installer can download WebView2 when it is missing. Prebuilt apps need no Rust or Node
installation, but unsigned downloads may trigger SmartScreen. Windows-on-Wine or a Linux
Docker build is not a substitute for the native Windows startup and interaction checks.

For cross-compilation from macOS, follow the
[Tauri Windows installer guide](https://v2.tauri.app/distribute/windows-installer/).
With LLVM, NSIS and `cargo-xwin` available, run from `desktop/tauri`:

```sh
cargo tauri build --runner cargo-xwin --target x86_64-pc-windows-msvc --bundles nsis
```

## Developer build and diagnostics

From the repository root, build the release binary without packaging the `.app` (this
convenience command requires Node.js/npm):

```sh
npm run build:tauri:binary
```

The shell accepts an explicit page URL using `--url <page>`, `--url=<page>`, or `BFFG_URL`.
A supplied URL remains pinned when using **Reconnect**. Otherwise, the shell probes port
19387 and a small range around it for this plugin's `/state` route. Harness 0.2.1 can bind
to an OS-assigned loopback port; the plugin passes the actual page URL to the shell for
that reason. Older fixed-port discovery is only a fallback for manual launch.

From the repository root, start a local preview server and manually launch the shell:

```sh
node preview/server.mjs --port 41739
./desktop/tauri/target/release/big-fat-fish-girl-shell \
  --url http://127.0.0.1:41739/big-fat-fish-girl/v1/desktop
```

If the server is not ready at launch, the shell checks for it every three seconds. A page
that responds but never mounts is reloaded at most ten times, with increasing pauses up to
one minute. Once mounted, the page's SSE connection handles reconnects. **Reconnect** reloads
the page and resets the native atlas cache.

From the repository root, run shell-core tests:

```sh
npm run test:core
```

The shell's `--self-test <page-url>` exercises page loading and the native bridge using an
offscreen WebView. It needs a desktop environment on the target OS. It does not replace
manual checks of visible rendering, focus and mouse input. No shell screenshot is currently
included; see
[`../../docs/preview/captures/README.md`](../../docs/preview/captures/README.md).

For the page/native interface and click-through details, see [`../README.md`](../README.md).
