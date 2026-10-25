// Animation manifest: the single source of truth for what the pet can do.
//
// Design rule: animation data is DATA. Adding a new sheet or a new animation must
// not require touching renderer or UI code — it is a new entry here (plus the art
// file). Entries marked `optional` may reference art that does not exist yet, so a
// contributor can land the manifest first and the art later; the engine simply
// skips what is unavailable.
//
// Geometry: a sheet is a grid of cells (columns x rows, cellWidth x cellHeight).
// An animation plays either a row prefix (`row` + `frames` count) or an explicit
// list of grid indices (`frames: [...]`, row-major: index = row * columns + column).
// That covers both uniform sprite rows and hand-picked sequences such as a
// ping-pong blink or a one-off gaze sweep.

/** Every runtime sheet uses a square 256 x 256 RGBA cell. */
export const CELL = Object.freeze({ cellWidth: 256, cellHeight: 256 })

/** The original atlas: 8 x 11 grid, repacked into the shared cell. */
export const BASE_SHEET = Object.freeze({
  file: 'spritesheet.png',
  columns: 8,
  rows: 11,
  ...CELL,
})

export const DEFAULT_MANIFEST = Object.freeze({
  version: 1,
  sheets: {
    base: BASE_SHEET,
    // Idle antics: stretch, straighten the headband, look around, play with a bubble, curl up.
    idle: { file: 'spritesheet-idle.png', columns: 6, rows: 5, ...CELL },
    // What she does while the model works.
    work: { file: 'spritesheet-work.png', columns: 6, rows: 4, ...CELL },
    // Snacks and a wallet: pure personality.
    food: { file: 'spritesheet-food.png', columns: 6, rows: 3, ...CELL },
    // The animation-v2 delivery: one authored strip per job, packed into 9×11 cells with
    // per-frame timings (assets/animation-v2/metadata.json). Non-loop strips clamp on
    // their hold frame, so a long hold is a frame, not a repeating scene.
    story: { file: 'spritesheet-story.png', columns: 9, rows: 11, ...CELL },
  },
  animations: [
    { id: 'idle', sheet: 'base', row: 0, frames: 6, fps: 3, loop: true },
    { id: 'runRight', sheet: 'base', row: 1, frames: 8, fps: 10, loop: true },
    { id: 'runLeft', sheet: 'base', row: 2, frames: 8, fps: 10, loop: true },
    { id: 'wave', sheet: 'base', row: 3, frames: 4, fps: 7, loop: true },
    { id: 'jump', sheet: 'base', row: 4, frames: 5, fps: 9, loop: false },
    { id: 'failed', sheet: 'base', row: 5, frames: 8, fps: 8, loop: true },
    { id: 'toolErrorReaction', sheet: 'base', row: 5, frames: 8, fps: 8, loop: false, holdFrame: 7, staticFrame: 7 },
    { id: 'waiting', sheet: 'base', row: 6, frames: 6, fps: 3, loop: true },
    { id: 'running', sheet: 'base', row: 7, frames: 6, fps: 5, loop: true },
    { id: 'review', sheet: 'base', row: 8, frames: 6, fps: 6, loop: true },
    { id: 'gaze', sheet: 'base', row: 9, frames: 8, fps: 1, loop: false, gazeRows: [9, 10] },
    // One-off look-around sweep: these separate frames intentionally turn the whole body.
    { id: 'lookAround', sheet: 'base', frames: [72, 74, 76, 78, 80, 82, 84, 86], fps: 6, loop: false },

    // Idle antics (sheet "idle"): each is one authored six-frame scene.
    { id: 'stretchYawn', sheet: 'idle', row: 0, frames: 6, fps: 5, loop: false },
    { id: 'adjustHeadband', sheet: 'idle', row: 1, frames: 6, fps: 5, loop: false },
    { id: 'peekAround', sheet: 'idle', row: 2, frames: 6, fps: 5, loop: false },
    { id: 'playWithBubble', sheet: 'idle', row: 3, frames: 6, fps: 5, loop: false },
    { id: 'sleep', sheet: 'idle', row: 4, frames: 6, fps: 2.5, loop: false, holdFrame: 5, staticFrame: 5 },

    // While the model works (sheet "work").
    { id: 'processInput', sheet: 'work', row: 0, frames: 6, fps: 4, loop: true },
    { id: 'composeReply', sheet: 'work', row: 1, frames: 6, fps: 4, loop: true },
    { id: 'useTool', sheet: 'work', row: 2, frames: 6, fps: 4, loop: true },
    { id: 'workComplete', sheet: 'work', row: 3, frames: 6, fps: 5, loop: false },

    // Snacks and coins (sheet "food").
    { id: 'eatRice', sheet: 'food', row: 0, frames: 6, fps: 5, loop: false, holdFrame: 5, staticFrame: 5 },
    { id: 'sushiTray', sheet: 'food', row: 1, frames: 6, fps: 5, loop: false, holdFrame: 5, staticFrame: 5 },
    { id: 'tokenWallet', sheet: 'food', row: 2, frames: 6, fps: 5, loop: false, holdFrame: 5, staticFrame: 5 },

    // The full animation-v2 delivery (sheet "story"). Timings are the artist's; every
    // strip keeps its readable hold frame for reduced motion and pauses.
    { id: 'waitingCall', sheet: 'story', row: 0, frames: 6, fps: 3, loop: false, holdFrame: 5, staticFrame: 5, frameDurationsMs: [180, 180, 180, 180, 260, 4000] },
    { id: 'replyTyping', sheet: 'story', row: 1, frames: 6, fps: 3, loop: true, holdFrame: 0, staticFrame: 0, frameDurationsMs: [260, 220, 220, 180, 220, 2600] },
    { id: 'editFile', sheet: 'story', row: 2, frames: 6, fps: 3, loop: true, holdFrame: 0, staticFrame: 0, frameDurationsMs: [260, 220, 220, 300, 220, 2600] },
    { id: 'think', sheet: 'story', row: 3, frames: 6, fps: 2, loop: true, holdFrame: 0, staticFrame: 0, frameDurationsMs: [700, 450, 450, 800, 450, 3000] },
    { id: 'reading', sheet: 'story', row: 4, frames: 6, fps: 2, loop: true, holdFrame: 0, staticFrame: 0, frameDurationsMs: [500, 700, 600, 600, 500, 3000] },
    { id: 'toolUse', sheet: 'story', row: 5, frames: 6, fps: 2, loop: true, holdFrame: 0, staticFrame: 0, frameDurationsMs: [500, 450, 500, 500, 450, 3000] },
    { id: 'problem', sheet: 'story', row: 6, frames: 6, fps: 3, loop: false, holdFrame: 5, staticFrame: 5, frameDurationsMs: [180, 180, 220, 220, 300, 4000] },
    { id: 'celebrate', sheet: 'story', row: 7, frames: 6, fps: 4, loop: false, holdFrame: 5, staticFrame: 5, frameDurationsMs: [350, 300, 300, 300, 500, 1200] },
    { id: 'restfulSleep', sheet: 'story', row: 8, frames: 6, fps: 2, loop: false, holdFrame: 5, staticFrame: 5, frameDurationsMs: [550, 450, 500, 650, 7000, 7000] },
    { id: 'sleepEnter', sheet: 'story', frames: [72, 73, 74, 75], fps: 2, loop: false, frameDurationsMs: [550, 450, 500, 650] },
    { id: 'sleepBreath', sheet: 'story', frames: [76, 77], fps: 0.14, loop: true, staticFrame: 1, frameDurationsMs: [7000, 7000] },
    { id: 'sleepWake', sheet: 'story', frames: [75, 74, 73, 72], fps: 2, loop: false, frameDurationsMs: [650, 500, 450, 550] },
    { id: 'snack', sheet: 'story', row: 9, frames: 6, fps: 3, loop: false, holdFrame: 5, staticFrame: 5, frameDurationsMs: [700, 600, 1000, 600, 1000, 1800] },
    { id: 'replyEnter', sheet: 'story', frames: [9, 10], fps: 3, loop: false, frameDurationsMs: [400, 400] },
    { id: 'replyLoop', sheet: 'story', frames: [11, 12, 13, 10], fps: 2, loop: true, staticFrame: 0, frameDurationsMs: [500, 500, 500, 500] },
    { id: 'replyExit', sheet: 'story', frames: [10, 9], fps: 3, loop: false, frameDurationsMs: [400, 400] },
    { id: 'editEnter', sheet: 'story', frames: [18, 19], fps: 3, loop: false, frameDurationsMs: [400, 400] },
    { id: 'editLoop', sheet: 'story', frames: [20, 21, 22, 19], fps: 2, loop: true, staticFrame: 0, frameDurationsMs: [500, 500, 500, 500] },
    { id: 'editExit', sheet: 'story', frames: [19, 18], fps: 3, loop: false, frameDurationsMs: [400, 400] },
    { id: 'readEnter', sheet: 'story', frames: [36, 37], fps: 2, loop: false, frameDurationsMs: [500, 500] },
    { id: 'readLoop', sheet: 'story', frames: [38, 39, 40, 37], fps: 1.5, loop: true, staticFrame: 0, frameDurationsMs: [700, 700, 700, 700] },
    { id: 'readExit', sheet: 'story', frames: [37, 36], fps: 2, loop: false, frameDurationsMs: [500, 500] },
    { id: 'thinkEnter', sheet: 'story', frames: [27, 28], fps: 1.5, loop: false, frameDurationsMs: [900, 450] },
    { id: 'thinkLoop', sheet: 'story', frames: [29, 30, 31, 32, 28], fps: 1.5, loop: true, staticFrame: 0, frameDurationsMs: [900, 900, 450, 450, 450] },
    { id: 'thinkExit', sheet: 'story', frames: [28, 27], fps: 1.5, loop: false, frameDurationsMs: [450, 900] },
    { id: 'toolEnter', sheet: 'story', frames: [45, 46], fps: 2, loop: false, frameDurationsMs: [500, 450] },
    { id: 'toolLoop', sheet: 'story', frames: [47, 48, 49, 50, 46], fps: 1.5, loop: true, staticFrame: 0, frameDurationsMs: [700, 700, 700, 700, 450] },
    { id: 'toolExit', sheet: 'story', frames: [46, 45], fps: 2, loop: false, frameDurationsMs: [450, 500] },
    { id: 'walletCheck', sheet: 'story', row: 10, frames: 9, fps: 3, loop: false, holdFrame: 8, staticFrame: 8, frameDurationsMs: [500, 400, 400, 450, 450, 500, 1100, 600, 500] },
  ],
  // Resolved by the engine, highest priority first: manual act, waiting, drag,
  // transient burst, running, hover act, idle act, idle.
  states: {
    idle: { anim: 'idle' },
    // Working with no better-known phase looks like quiet thinking.
    running: { anim: 'think', fallback: 'processInput' },
    // The waiting strip carries its own approach and a long hold on the user-facing pose.
    waiting: { anim: 'waitingCall', fallback: 'waiting' },
    welcome: { anim: 'wave' },
    // Finishing up and settling back into idle.
    review: { anim: 'celebrate', fallback: 'workComplete' },
    failed: { anim: 'problem', fallback: 'failed' },
    // A token-limited stop is a quiet note: no celebration, no failure pose.
    limited: { anim: 'idle' },
    dragRight: { anim: 'runRight' },
    dragLeft: { anim: 'runLeft' },
    gaze: { anim: 'gaze', gaze: true },
    sleeping: { anim: 'restfulSleep', fallback: 'sleep' },
  },
  // Which animation answers a tool call, per phase (the mapping lives in lib/host/model.mjs).
  // Data, like everything else: a new tool family is one line here. When the v2 segment
  // art is unavailable the engine falls back through `scenes`.
  toolActs: {
    reading: 'reading',
    searching: 'processInput',
    browsing: 'processInput',
    planning: 'processInput',
    writing: 'editFile',
    commanding: 'useTool',
    delegating: 'useTool',
    asking: 'useTool',
    using: 'useTool',
  },
  // Long actions are scenes, not loops: enter brings the prop out, loop/hold is the
  // quiet work, exit puts it away. `fallback` keeps the pet working on the old art.
  scenes: {
    waiting: { enter: 'waitingCall', hold: 'waitingCall', static: 'waitingCall', fallback: 'waiting' },
    compose: { enter: 'replyEnter', loop: 'replyLoop', exit: 'replyExit', static: 'replyLoop', fallback: 'composeReply', micros: ['gaze'] },
    edit: { enter: 'editEnter', loop: 'editLoop', exit: 'editExit', static: 'editLoop', fallback: 'useTool', micros: ['gaze'] },
    reading: { enter: 'readEnter', loop: 'readLoop', exit: 'readExit', static: 'readLoop', fallback: 'processInput', micros: ['gaze'] },
    processing: { enter: 'thinkEnter', loop: 'thinkLoop', exit: 'thinkExit', static: 'thinkLoop', fallback: 'processInput', micros: ['gaze'] },
    tool: { enter: 'toolEnter', loop: 'toolLoop', exit: 'toolExit', static: 'toolLoop', fallback: 'useTool', micros: ['gaze'] },
    // Reuse the existing small-panel action until a dedicated card-board animation is authored.
    team: { enter: 'toolEnter', loop: 'toolLoop', exit: 'toolExit', static: 'toolLoop', fallback: 'useTool', micros: ['gaze'] },
    review: { enter: 'celebrate', hold: 'celebrate', static: 'celebrate', fallback: 'workComplete' },
    problem: { enter: 'problem', hold: 'problem', static: 'problem', fallback: 'failed' },
    toolError: { enter: 'toolErrorReaction', hold: 'toolErrorReaction', static: 'toolErrorReaction', fallback: 'failed' },
    sleep: { enter: 'sleepEnter', loop: 'sleepBreath', exit: 'sleepWake', static: 'sleepBreath', fallback: 'sleep' },
    // Snacks favor the authored story strip; rice is a familiar alternative and sushi is rare.
    // The engine fixes one available variant for the whole scene, including an interrupted resume.
    meal: {
      variants: [
        { anim: 'snack', weight: 8 },
        { anim: 'eatRice', weight: 3 },
        { anim: 'sushiTray', weight: 1 },
      ],
      fallback: 'eatRice',
    },
    wallet: { enter: 'walletCheck', hold: 'walletCheck', static: 'walletCheck', fallback: 'tokenWallet' },
  },
  // Random behaviours. `weight` is relative, `ms` is how long one outburst lasts.
  acts: {
    hover: [
      { anim: 'wave', weight: 4, ms: 1200 },
      { anim: 'jump', weight: 3, ms: 1000 },
    ],
    idle: [
      { anim: 'stretchYawn', weight: 3, ms: 3000 },
      { anim: 'adjustHeadband', weight: 3, ms: 2600 },
      { anim: 'peekAround', weight: 3, ms: 2600 },
      { anim: 'playWithBubble', weight: 2, ms: 3000 },
      { anim: 'eatRice', weight: 3, ms: 3200 },
      { anim: 'sushiTray', weight: 2, ms: 3000 },
      { anim: 'tokenWallet', weight: 2, ms: 3000 },
      { anim: 'lookAround', weight: 2, ms: 1400 },
      { anim: 'wave', weight: 1, ms: 1200 },
    ],
    // Played while the model is working, paced more often than idle antics.
    working: [
      { anim: 'composeReply', weight: 3, ms: 4000 },
      { anim: 'useTool', weight: 3, ms: 4000 },
      { anim: 'processInput', weight: 2, ms: 4000 },
      { anim: 'running', weight: 2, ms: 3000 },
    ],
  },
})
