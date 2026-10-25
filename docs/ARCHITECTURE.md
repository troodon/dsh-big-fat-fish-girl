# Architecture

Big Fat Fish Girl is a DeepSeek Harness plugin with an in-page overlay and an optional
always-on-top desktop pet. The desktop pet stays visible while Harness is minimized and
reflects aggregate activity across chats. Both surfaces share domain modules; animation and
behavior stay independent of the DOM, timers and network. The plugin never reads or stores
prompts, responses, tool arguments or session titles, and makes no telemetry or external
service calls.

```
                        ┌──────────────────────────────────────────────┐
   DSH session events →  │ lib/host/host-adapter.mjs  event vocabulary      │
                        │  (the only file that knows Harness names)    │
                        └────────────────────┬─────────────────────────┘
                                             │ phases, endings, opaque ids
                        ┌────────────────────▼─────────────────────────┐
                        │ lib/host/model.mjs      per-task reducer          │
                        │ lib/host/aggregate.mjs  selection + pinned request│
                        └────────────────────┬─────────────────────────┘
                                             │ snapshot v3: mood, phase, open
                                             │ tools, team, toolError, target
                        ┌────────────────────▼─────────────────────────┐
                        │ lib/host/index.mjs      host half                 │
                        │  /state /events /manifest /sheet/ /desktop   │
                        │  /navigate (allow-listed, SSE broadcast)     │
                        └────────────────────┬─────────────────────────┘
                                             │ HTTP + SSE
              ┌──────────────────────────────┴───────────────────────────┐
              │                                                          │
   ┌──────────▼───────────┐                              ┌───────────────▼──────────────┐
   │ lib/web/client-entry.mjs │                              │ desktop/pet-desktop.mjs      │
   │ in-page overlay      │                              │ standalone page for shells   │
   └──────────┬───────────┘                              └───────────────┬──────────────┘
              │                                                          │ window.__BFFG_SHELL__
              │        ┌────────────────────────────────────────┐        │
              └───────►│ shared domain modules (pure)           │◄───────┘
                       │ animation · behavior · i18n · rendering│
                       │ settings · protocol                    │
                       └────────────────────────────────────────┘
                                       │ pose, bubble, click target
                                       ▼
                               desktop/tauri (Tauri v2)
```

## Modules

The code is grouped by responsibility. The domain modules in `lib/animation`, `lib/behavior`,
`lib/i18n`, `lib/rendering`, `lib/settings` and `lib/protocol` stay pure: no DOM, timers or
network, so they run in the page, desktop shell and tests. `test/architecture.test.mjs` enforces
those boundaries. `lib/host` runs inside Harness; `lib/web` owns the browser surface and builds
on the domain modules. Host and web do not import each other.

| Module | Responsibility | Must not |
| --- | --- | --- |
| `lib/host/host-adapter.mjs` | Harness 0.2.0-rc.2 event vocabulary, event translation and tool classification | keep tool names, arguments or stream text |
| `lib/settings/prefs.mjs` | Settings defaults, validation and the values behind the `Config` schema; one source for host, page and preview | keep per-window state or behaviour |
| `lib/host/model.mjs` | Per-task reducer: turns, open tool calls keyed by call id, approvals/questions, transient endings | store prompt text, tool names, arguments, session titles |
| `lib/host/aggregate.mjs` | Which root task is shown, which request is pinned, counters | know about art or the DOM |
| `lib/host/index.mjs` | Declare the settings `Config` schema, serve the snapshot (with prefs), the event stream, the manifest, the skins and their sheets; broadcast an allow-listed navigate command | accept arbitrary writes; serve files outside its whitelist |
| `lib/host/live-channel.mjs` | The event stream to every page: one stream per client, heartbeats, the snapshot and navigate messages | decide what a snapshot says |
| `lib/host/shell-presence.mjs` | Whether a desktop shell is showing the pet, with a grace period after it disconnects | know about the overlay or the DOM |
| `lib/host/skins.mjs` | The installed skins under `lib/skins/`: listing, title lookup and fallback | serve anything but a whitelisted sheet |
| `lib/host/host-routes.mjs` | The HTTP surface: state, sheets per skin, skin list, manifest, desktop page, navigate | accept arbitrary paths or writes |
| `lib/animation/manifest.mjs` | Animation data, scenes (enter/loop/exit), static/hold frames, validation, frame math | know about the DOM |
| `lib/animation/engine.mjs` | Decide *what* to draw now (priority list, scenes, transients, gaze, sleep) | touch the DOM, timers or the network |
| `lib/behavior/everyday.mjs` | The snack after long work and the wallet check after a job: their clocks, counters and quiet rules | pick poses or draw the bubble |
| `lib/diagnostics.mjs` | Report recoverable failures once per cause | decide whether a failure is fatal |
| `lib/web/debug-surface.mjs` | The test seam, open only for a page that opts in | be relied on by anything a production page does |
| `lib/behavior/tempo.mjs` | Every pacing number in one profile | hold any logic |
| `lib/behavior/behavior.mjs` | One decision for pose, bubble and click; pacing, sleep, hover, scene switching, snack by work stack, wallet after completion | touch the DOM or the network |
| `lib/behavior/planner.mjs` | When a spontaneous act may play (idle, working, hover) | know what an act looks like |
| `lib/behavior/wander.mjs` | How far to stroll and which way to face | move anything itself |
| `lib/i18n/lines.mjs`, `lines.en.mjs`, `lines.ru.mjs`, `lines.zh-CN.mjs` | Phrase pools; waiting and problems are fixed anchors | contain behaviour |
| `lib/i18n/strings.mjs`, `ui.en.mjs`, `ui.ru.mjs`, `ui.zh-CN.mjs` | Interface text for the overlay, settings and native menu labels | contain behaviour or hardcoded fallbacks |
| `lib/animation/gaze.mjs` | Cursor position → one of 16 directions | know the sprite layout |
| `lib/protocol/contract.mjs` | The wire contract: route prefix, snapshot version, moods and phases, and the one normaliser every page uses | know the DOM, Harness names or the renderer |
| `lib/web/transport.mjs` | SSE with a polling fallback; navigation events; connection state | throw at the caller; decide what a snapshot means |
| `lib/web/pet-controller.mjs` | The controller both pages drive: animation core, sheets, frame loop, bubble, settings, strolls. A surface plugs in through hooks | know which surface it runs on, Harness names |
| `lib/web/client-entry.mjs` | In-page overlay: DOM, pointer, dragging, `uiWorkspace` navigation; settings arrive from the host snapshot; hides while a desktop shell page is connected (`shellActive`) | decide animation priorities |
| `desktop/pet-desktop.mjs` | The same controller, plus the shell bridge and the navigate POST | assume a shell exists |
| `desktop/tauri` | Window, click-through (sprite + bubble regions), native drag deltas, native menu, focus Harness | carry a copy of the art |

The animation engine takes a timestamp and returns a frame. That is why the same behaviour runs
in a page and in a Tauri window, and why it can be tested with an injected
clock instead of `setTimeout`.

## Data flow

1. Harness emits a session event. `lib/host/host-adapter.mjs` translates it into a meaning —
   turn ending, phase, an open request — and drops the names and text.
2. `lib/host/model.mjs` reduces meanings per task: active turns, open tool calls keyed by call
   id, approvals/questions, subagent parents. `lib/host/aggregate.mjs` picks the displayed root
   task and the pinned request.
3. `lib/host/index.mjs` publishes snapshot v3 over SSE (and `/state` for a cold start).
4. The surface normalises it (`transport.mjs`) and hands it to `behavior.mjs`, which makes
   one decision for pose, bubble and click and drives the engine.
5. The engine resolves one animation (a scene's enter/loop/exit, or a classic action); the
   page draws the cell from the sheet it arrives in, loading that sheet on first use.
6. A click on an open request attempts navigation: the in-page client calls
   `uiWorkspace.openSession`; the shell POSTs an opaque `targetRef` to `/navigate` and focuses
   Harness. In observed desktop behavior, Harness opens its last active chat; exact-chat
   navigation is not guaranteed.
7. Whatever moves the pet — dragging, strolling — is expressed as a delta: the page moves
   an element, the shell moves a window.

## Invariants

These invariants describe enforced behavior; the listed tests cover each one.

| Invariant | Enforced by |
| --- | --- |
| Only transient ids and status edges are kept; no prompt, response, arguments or titles | `test/host-adapter.test.mjs`, `test/model.test.mjs` (serialised snapshots carry no tool names or arguments) |
| One opaque navigation ref may cross the wire, and only while its target is open | `test/model.test.mjs` (privacy test), `test/host.test.mjs` (navigate allow-list) |
| Token counts are numbers only; subagents are summed into their root exactly once, and absent data stays `null` | `test/model.test.mjs`, `test/host-adapter.test.mjs` |
| The adapter is the only place that knows Harness event names; unknown events are ignored | `test/host-adapter.test.mjs` |
| Waiting outranks every act, forced included, and interrupts a running scene on the spot | `test/engine.test.mjs`, `test/behavior.test.mjs` |
| An open tool call is tracked by call id and never expires on a timer; parallel calls survive out-of-order results | `test/model.test.mjs` |
| Cancellation is not failure; token limits and errors are distinct endings | `test/model.test.mjs` |
| On cold start live sessions are replayed (`session.log`), not assumed idle | `test/host.test.mjs` |
| The navigate route accepts only refs that are open right now, and never arbitrary commands | `test/host.test.mjs` |
| The HTTP surface is read-only apart from that allow-listed navigate command | `test/host.test.mjs`, `test/verify-routes.test.mjs` (`state is read-only`) |
| Sheets come from a whitelist; no path traversal | `test/host.test.mjs`, `test/preview-server.test.mjs`, `test/verify-routes.test.mjs` |
| The desktop page is self-contained (no external `script`/`link`) | `test/host.test.mjs`, `test/desktop-smoke.test.mjs`, `test/verify-routes.test.mjs` |
| Animations are data: states, act groups, tool phases and scenes are validated against real animations | `test/manifest.test.mjs`, `verify-assets` |
| A new act group, tool phase or scene needs no code change | `test/manifest.test.mjs` (every declared group reaches the index) |
| All sheets declare the same cell dimensions, keeping draw scale consistent across animations | `test/manifest.test.mjs` |
| The manifest and the PNGs agree in geometry, and every sheet is in the package | `test/manifest.test.mjs`, `test/package.test.mjs`, `verify-assets` |
| Reduced motion shows each animation's chosen anchor frame, not an arbitrary first one | `test/manifest.test.mjs` |
| Sleep is an enter/breath/wake scene: cursor motion does not wake her, an explicit click plays the wake-up | `test/engine.test.mjs`, `test/behavior.test.mjs` |
| A scene plays one entry, a stable loop and an exit; only the newest destination waits behind an exit | `test/engine.test.mjs`, `test/behavior.test.mjs` |
| The native drag direction comes from the latest cursor delta reported by the shell | `test/desktop-smoke.test.mjs` (mock bridge) |
| A failed tool result plays one short reaction; duplicates, declined approvals and reconnects do not replay it | `test/model.test.mjs`, `test/behavior.test.mjs` |
| The same snapshot produces the same pose, bubble and click target in both surfaces | `test/behavior.test.mjs`, `test/client-smoke.test.mjs`, `test/desktop-smoke.test.mjs` |
| Settings have one schema, one set of defaults and one validation path; the pet has no settings UI of its own | `test/prefs.test.mjs`, `test/client-smoke.test.mjs` (prefs arrive via the snapshot) |
| A click and a drag are different: only a clean click navigates | `test/desktop-smoke.test.mjs` |
| A snack needs accumulated work (waiting time does not count), is interrupted by a request, respects its cooldown and hands the pose back to the current phase | `test/behavior.test.mjs` |
| The wallet check is scheduled once per completion; new work, cancellation and cooldown suppress it | `test/behavior.test.mjs` (model: review never fires on abort) |
| Strolls are rare: 20–40 minutes apart, at most two starts in any rolling hour, postponed by work and requests | `test/wander.test.mjs`, `test/behavior.test.mjs` |
| Act cadences: activity delays idle acts but not working acts | `test/planner.test.mjs` |
| Strolling stays inside its bounds and never jumps on a stalled frame | `test/wander.test.mjs` |
| The pet mounts even if the module is applied before `<body>` exists | `test/client-smoke.test.mjs` |
| The overlay is anchored to the viewport | `test/client-smoke.test.mjs` |
| The window never leaves the work area; the page only strolls when the shell says where the screen ends | `test/desktop-smoke.test.mjs` |
| The committed bundles match their sources | `build:check`, `build:desktop:check` |
| Recoverable failures are reported once per cause | `test/diagnostics.test.mjs`, `test/engine.test.mjs` (a throwing listener), `test/host-routes.test.mjs` (404 for missing, 500 for a fault) |
| A page the shell cannot mount is reloaded a bounded number of times, with growing pauses | `desktop/tauri/src-tauri/src/connection.rs` (`the_retries_are_bounded_to_a_quarter_hour`) |
| The debug surface is closed for a page that does not opt in | `test/client-smoke.test.mjs` (`a production page exposes no debug surface`) |
| The shipped tarball installs, serves the contract and renders | `npm run verify:release` |

## Failure behaviour

Recoverable failures are reported.

- A sheet that fails to load marks its animations unavailable; animations with loaded sheets
  remain usable.
- If the atlas has not loaded, click-through is disabled so the window remains accessible.
- If the host is unreachable, the transport retries. If no snapshot is available, the client
  waits for the next update.
- Failures that prevent the page from showing content are reported by `verify-assets`, the
  route checker or the browser console.

## Extending

| To add | Change |
| --- | --- |
| An animation | A sheet row plus a manifest entry — see [adding-an-animation.md](adding-an-animation.md) |
| A skin | A folder under `lib/skins/<id>/` with sheet files and `skin.json`; verify it with `npm run verify` |
| An idle or working act | One entry in `acts.idle` / `acts.working` |
| A tool family | One entry in `toolActs` plus a pattern in `lib/host/host-adapter.mjs` |
| A state | One entry in `states` (and, if it needs new timing, in the chrome's loop) |
| A surface | A page that speaks `window.__BFFG_SHELL__` — see [../desktop/README.md](../desktop/README.md) |
| A language | A `lines.<locale>.mjs` pool file with the same keys |
