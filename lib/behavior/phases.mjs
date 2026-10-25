// Phase and scene tables the controller works from: which scene (or legacy animation) a work
// phase looks like, and which phrase pool it speaks from. Snapshots are normalised in
// lib/protocol/contract.mjs, not here.
import { linesFor } from '../i18n/lines.mjs'

/** Which scene (or legacy animation) a work phase looks like. */
export const PHASE_SCENES = Object.freeze({
  'tool:reading': { scene: 'reading', anim: 'reading' },
  'tool:writing': { scene: 'edit', anim: 'editFile' },
  'tool:searching': { scene: 'processing', anim: 'processInput' },
  'tool:browsing': { scene: 'processing', anim: 'processInput' },
  'tool:planning': { scene: 'processing', anim: 'processInput' },
  'tool:commanding': { scene: 'tool', anim: 'useTool' },
  'tool:delegating': { scene: 'team', anim: 'useTool' },
  'tool:asking': { scene: 'tool', anim: 'useTool' },
  'tool:using': { scene: 'tool', anim: 'useTool' },
  'assistant:composing': { scene: 'compose', anim: 'composeReply' },
  'assistant:processing': { scene: 'processing', anim: 'processInput' },
})

/** Which phrase pool a work phase speaks from. */
export const PHASE_POOLS = Object.freeze({
  'tool:reading': 'reading',
  'tool:writing': 'editing',
  'tool:searching': 'searching',
  'tool:browsing': 'browsing',
  'tool:planning': 'planning',
  'tool:commanding': 'commanding',
  'tool:delegating': 'delegating',
  'tool:asking': 'asking',
  'tool:using': 'using',
  'assistant:composing': 'writing',
  'assistant:processing': 'working',
})

/** Every scene a work phase can own, including the coordination panel. */
export const WORK_SCENES = new Set(Object.values(PHASE_SCENES).map((mapping) => mapping.scene))

export function phaseKey(snapshot) {
  if (snapshot.tool !== null && snapshot.tool.open) return `tool:${snapshot.tool.phase}`
  if (snapshot.phase !== null) return `assistant:${snapshot.phase}`
  return null
}

export function fixedLine(locale, pool) {
  const lines = linesFor(locale, pool)
  return lines.length > 0 ? lines[0] : null
}
