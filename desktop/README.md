# Desktop pet

Big Fat Fish Girl is a DeepSeek Harness plugin. Its desktop pet shows aggregate activity
across all open chats in a transparent, always-on-top window, so it remains visible while
you minimize Harness. The macOS Tauri shell is a separate app.

## Use the macOS app

The Tauri shell is separate from the Harness plugin; the npm package does not include the
app or Rust sources. Use the [macOS install guide](../docs/INSTALL.md) to install both from
the same release, using an app archive attached to that release or a local build from its
source tag.

With the shell installed, **Start with Harness** (on by default) starts it with Harness and
stops only the process the plugin itself started. You can turn this off to manage the shell
manually. Harness passes the current page URL when it starts the shell.

The tested macOS build is arm64; Intel is untested. Windows is untested, and there is no
Linux build. The pet stays above ordinary windows; full-screen coverage is not promised.
Clicking the pet or its bubble brings Harness forward on its last-open chat, not a specific
session. Release app archives are ad-hoc signed, not Developer ID-signed or notarized.

See [`tauri/README.md`](tauri/README.md) for build and manual-launch diagnostics.

## Shell/page bridge

The page can run without a native bridge (for example in a browser preview). The shell
injects optional methods before page scripts run:

```js
window.__BFFG_SHELL__ = {
  moveBy(dx, dy) {},
  menu(x, y, labels) {},
  setSize(px) {},
  quit() {},
  state(snapshot) {},
  frame(cell) {},
  openTarget(target) {},
  interactiveRegions(regions) {},
  onDragMove(listener) {},
  startDrag(session, grabbedX, grabbedY) {},
  endDrag(session) {},
}
```

`openTarget` requests Harness focus; the page-side client handles the navigation attempt.
Harness opens on its last-open chat. The shell also exposes commands to the page through
`window.__BFFG_DESKTOP_CMD__`: `play(anim, ms)`,
`setSize(px)`, `setVisible(bool)`, `setBounds({ minX, maxX })`, `setPosition(x)`, and
`setWander(bool)`. The page chooses how far to wander; the shell supplies screen bounds.
Without bounds the pet stays put rather than walking off-screen.

### Drag and click-through

Native dragging is needed to move the OS window; the shell reports cursor deltas back to the
page while pointer events are unavailable. Drag takeover can be refused, in which case the
page falls back to in-page movement.

Transparent pixels must pass clicks to the app underneath, while the pet, visible bubble
and menu, and active drag remain interactive. Since an ignored-mouse window cannot receive
a click to re-enable mouse events, the shell polls the global cursor and hit-tests against
the sprite alpha and interactive regions. If the atlas is unavailable, the shell stays
interactive rather than making the pet impossible to click.

The current Tauri implementation targets macOS. Its window is above ordinary windows, but
`alwaysOnTop` does not ensure coverage above full-screen apps. The event contract documented
in [`../docs/HARNESS-CONTRACT-v0.2.0-rc.2.md`](../docs/HARNESS-CONTRACT-v0.2.0-rc.2.md)
is specifically for Harness 0.2.0-rc.2; it is not a claim that all of Harness 0.2.1 has
been verified.
