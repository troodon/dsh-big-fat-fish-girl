# Harness contract: DeepSeek Harness 0.2.0-rc.2

Date: October 6, 2026. Source: the installed `/Applications/DeepSeek Harness.app`
(`@deepseek-ai/dsh-desktop` 0.2.0-rc.2, runtime
`@deepseek-ai/dsh-desktop-runtime` 0.2.0-rc.2, build
`5e9e301dd9dc8923b2762f76dacfc5751f6ca851`). `app.asar` was read in place; files were not
extracted. This document describes that version only. Notes about 0.2.1 are separate and do
not change the version covered here.

## Session events

Events arrive through `ctx.on('session/event', (session, event) => …)`. The event types are
listed in `SessionEventMap` in
`@deepseek-ai/dsh-agent-preset-registry/lib/typert.host.js`. The plugin listens only to
events confirmed by that map (`lib/host/host-adapter.mjs`).

| Event | Payload | Plugin use |
| --- | --- | --- |
| `turn/start` | `{ turn }` | Marks the task active again |
| `turn/end` | `{ turn, reason: TurnEndReason }` | Determines the turn outcome; see below |
| `step/start` / `step/end` | `{ turn, step }` | Not currently used |
| `tool/call` | `{ turn, step, callId, name, arguments }` | Classifies the phase by name and uses `callId` to pair events; discards arguments |
| `tool/result` | `{ turn, step, message, error?, meta? }` | Closes the call using `message.source.callId` |
| `approval/asked` | `{ id, toolName, callId?, reason? }` | Tracks a pending approval; maps `toolName` to a phase |
| `approval/decided` | `{ id, outcome }` | Tracks the outcome: `allowed-once` / `rejected` / `cancelled` / `unavailable` |
| `assistant/attempt` | `{ turn, step, stream }` | Sets the processing phase |
| `assistant/message` | `{ turn, step, message, stream, usage?, interrupted? }` | Uses `stream` to distinguish `reasoning-chunks` from `text-chunks`, without reading text |
| `subagent/descriptor` | `SubagentDescriptorData` | Tracks subagent activity |

`TurnEndReason` in this version:

- `completed` — the turn completed.
- `aborted { reason: AgentCancelCause }`, where the reason is `user | parent | hook | disposed | legacy`.
  User cancellation is not a failure; the other causes are lifecycle or system events.
- `blocked` — work is waiting for the user.
- `error { error: LlmFailure }` — terminal error (`{ message, code, status?, … }`).
- `max-tokens` — stopped at the limit; this is not completion.
- `interrupted` — interrupted (for example, by a new message), not an error.
- `forked` — the task branched; this is not an error.

A session has `SessionHeader { id, createdAt, cwd?, parentSession?, origin?: 'subagent',
delegationDepth?, agentPreset? }`. A subagent is linked to its parent by `parentSession` and
`origin: 'subagent'`.

Privacy: `assistant/message.stream` can contain text, but the adapter reads only
`record.type`. Tool names stay inside `lib/host/host-adapter.mjs`; only classified phases are
passed on.

## Cold start

In 0.2.0-rc.2, a live `Session` has no `events` property. It has `log` (an ordered array),
`seq` and `eventAt(seq)`. Hydration replays `session.log` (or uses `eventAt`), keeping only
`TRACKED_EVENTS`; event content is not stored. The previous check for `session.events`
loaded nothing without reporting an error.

## Navigation

Harness has no public deep link to a specific chat: `dsh://open` focuses the main window
(`/lib/main.js`: `focusPrimaryWindow`). The browser client provides
`uiWorkspace.openSession(sessionId)`. An approval appears in the composer; a question appears
in the conversation. `uiSession` exposes `running`, `pendingInteraction` and
`completionUnread` for sessions.

The plugin sends an opaque `targetRef` in a POST to `/big-fat-fish-girl/v1/navigate`. The host
accepts only currently allowed references and broadcasts an SSE `navigate` event. This is a
wire-level attempt to open a target: the in-page client may call `uiWorkspace.openSession`,
while the desktop shell calls `dsh://open`. In observed desktop use, clicking brings Harness
forward on its last-active chat; opening the exact chat from `targetRef` is not guaranteed.

## Host services used by the plugin

- `webServer` (`super(ctx, "webServer")`): `register({ kind: 'exact' | 'prefix', path,
  handler })`; upgrade routes are also available. This contract has not changed.
- Separate from the 0.2.0-rc.2 contract: the local shell-origin fix for 0.2.1 starts the
  desktop profile with `--port 0`, so the OS assigns a port (for example, 50543) instead of
  using fixed port 19387. The host provides its origin through `ctx.webServer.getOrigin()`
  (which throws until the port is bound) and `ctx.webServer.port`. The plugin passes that
  origin to the shell as `--url`; it cannot rely on the old fixed port.
- `sessions` (`super(ctx, "sessions")`): `list()` returns live sessions in creation order;
  `get(id)` retrieves one session.
- `ctx.on('session/event')` is confirmed.

## Not part of the contract

- There are no `request/error`, `tool/error` or `response/error` events. Errors arrive through
  `turn/end{reason.error}`, `tool/result.error`, `assistant/message.interrupted` and
  `compaction/end.error`. The previous tracked-event list missed these paths.
- No real account balance API was found. Turn `usage` is `TokenUsage`:
  `inputTokens`, `outputTokens`, `totalTokens?`, `cacheReadTokens?`, `cacheWriteTokens?` and
  `reasoningTokens?`. The wallet display uses provider-reported token counts, not a balance.
- Deep links on Windows and Linux, and Tauri behavior on those platforms, require separate
  verification.

## Checks

`lib/host/host-adapter.mjs` handles only the event types listed here. Test fixtures are in
`test/host-adapter.test.mjs` and `test/model.test.mjs`. When updating Harness support, update
the adapter and this document first, then the rest of the code.
