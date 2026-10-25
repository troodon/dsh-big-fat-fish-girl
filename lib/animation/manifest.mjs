// Manifest validation, indexing and frame math — the code half.
// The data half lives in manifest-defaults.mjs; together they are the single source
// of truth for what the pet can do.

export { CELL, BASE_SHEET, DEFAULT_MANIFEST } from './manifest-defaults.mjs'

/** Grid indices a row-prefix animation can use. */
function rowIndices(sheet, animation) {
  const start = animation.row * sheet.columns
  return Array.from({ length: animation.frames }, (_, i) => start + i)
}

/**
 * Validate a manifest. Returns `{ ok, problems }` — never throws, so the same
 * function is usable as a build gate and as a runtime guard.
 */
export function validateManifest(manifest) {
  const problems = []
  if (manifest === null || typeof manifest !== 'object') return { ok: false, problems: ['manifest is not an object'] }
  if (manifest.version !== 1) problems.push(`unsupported version: ${String(manifest.version)}`)

  const sheets = manifest.sheets ?? {}
  for (const [id, sheet] of Object.entries(sheets)) {
    if (!sheet || typeof sheet !== 'object') { problems.push(`sheet "${id}" is not an object`); continue }
    if (typeof sheet.file !== 'string' || sheet.file === '') problems.push(`sheet "${id}": file is required`)
    for (const key of ['columns', 'rows', 'cellWidth', 'cellHeight']) {
      const value = sheet[key]
      if (!Number.isInteger(value) || value <= 0) problems.push(`sheet "${id}": ${key} must be a positive integer`)
    }
  }

  const seen = new Set()
  const animations = Array.isArray(manifest.animations) ? manifest.animations : []
  if (animations.length === 0) problems.push('animations must not be empty')
  for (const animation of animations) {
    const id = animation?.id
    if (typeof id !== 'string' || id === '') { problems.push('every animation needs a string id'); continue }
    if (seen.has(id)) problems.push(`duplicate animation id: ${id}`)
    seen.add(id)

    const sheet = sheets[animation.sheet]
    if (sheet === undefined) { problems.push(`animation "${id}": unknown sheet "${String(animation.sheet)}"`); continue }
    if (typeof animation.fps !== 'number' || !(animation.fps > 0)) problems.push(`animation "${id}": fps must be > 0`)

    const explicit = Array.isArray(animation.frames)
    let frameCount = 0
    if (explicit) {
      if (animation.frames.length === 0) problems.push(`animation "${id}": frames must not be empty`)
      frameCount = animation.frames.length
      const cells = sheet.columns * sheet.rows
      for (const index of animation.frames) {
        if (!Number.isInteger(index) || index < 0 || index >= cells) {
          problems.push(`animation "${id}": frame index ${String(index)} outside 0..${cells - 1}`)
        }
      }
    } else {
      if (!Number.isInteger(animation.row) || animation.row < 0 || animation.row >= sheet.rows) {
        problems.push(`animation "${id}": row ${String(animation.row)} outside the sheet (${sheet.rows} rows)`)
        continue
      }
      if (!Number.isInteger(animation.frames) || animation.frames <= 0 || animation.frames > sheet.columns) {
        problems.push(`animation "${id}": frames must be 1..${sheet.columns}`)
      }
      frameCount = Number.isInteger(animation.frames) ? animation.frames : 0
    }
    // Static/hold frames are the readable anchors for reduced motion and pauses.
    for (const key of ['staticFrame', 'holdFrame']) {
      const value = animation[key]
      if (value === undefined) continue
      if (!Number.isInteger(value) || value < 0 || value >= frameCount) {
        problems.push(`animation "${id}": ${key} ${String(value)} outside 0..${Math.max(0, frameCount - 1)}`)
      }
    }
    // Authored timings, when present, must cover every frame exactly once.
    const durations = animation.frameDurationsMs
    if (durations !== undefined) {
      if (!Array.isArray(durations) || durations.length !== frameCount) {
        problems.push(`animation "${id}": frameDurationsMs must have ${frameCount} entries`)
      } else {
        for (const duration of durations) {
          if (!Number.isFinite(duration) || duration <= 0) {
            problems.push(`animation "${id}": frame durations must be positive numbers`)
            break
          }
        }
      }
    }
  }

  for (const [phase, animId] of Object.entries(manifest.toolActs ?? {})) {
    if (typeof animId !== 'string' || !seen.has(animId)) {
      problems.push(`toolActs "${phase}": unknown animation "${String(animId)}"`)
    }
  }

  // Scenes are the enter/loop/hold/exit composition. Every reference must resolve so
  // the engine can always fall back to something the pet can actually draw.
  for (const [name, scene] of Object.entries(manifest.scenes ?? {})) {
    if (scene === null || typeof scene !== 'object') { problems.push(`scene "${name}" is not an object`); continue }
    for (const key of ['enter', 'loop', 'exit', 'static', 'fallback']) {
      const value = scene[key]
      if (value === undefined) continue
      if (typeof value !== 'string' || !seen.has(value)) {
        problems.push(`scene "${name}": ${key} references unknown animation "${String(value)}"`)
      }
    }
    if (scene.variants !== undefined) {
      if (!Array.isArray(scene.variants) || scene.variants.length === 0) {
        problems.push(`scene "${name}": variants must be a non-empty array`)
      } else {
        for (const variant of scene.variants) {
          if (typeof variant?.anim !== 'string' || !seen.has(variant.anim)) {
            problems.push(`scene "${name}": variant references unknown animation "${String(variant?.anim)}"`)
          }
          if (!(typeof variant?.weight === 'number' && Number.isFinite(variant.weight) && variant.weight > 0)) {
            problems.push(`scene "${name}": variant weight must be a positive finite number`)
          }
        }
      }
    }
    for (const micro of scene.micros ?? []) {
      if (typeof micro !== 'string' || !seen.has(micro)) {
        problems.push(`scene "${name}": micro references unknown animation "${String(micro)}"`)
      }
    }
    if (scene.loop === undefined && scene.fallback === undefined && scene.enter === undefined
      && (scene.variants === undefined || scene.variants.length === 0)) {
      problems.push(`scene "${name}": needs at least a loop, an enter, a variant or a fallback`)
    }
  }

  for (const [name, state] of Object.entries(manifest.states ?? {})) {
    if (!state || typeof state !== 'object' || typeof state.anim !== 'string') { problems.push(`state "${name}": anim is required`); continue }
    if (!seen.has(state.anim)) problems.push(`state "${name}": unknown animation "${state.anim}"`)
    if (state.fallback !== undefined && (typeof state.fallback !== 'string' || !seen.has(state.fallback))) {
      problems.push(`state "${name}": unknown fallback animation "${String(state.fallback)}"`)
    }
    if (state.gaze === true && !Array.isArray(animations.find((a) => a?.id === state.anim)?.gazeRows)) {
      problems.push(`state "${name}": gaze animation "${state.anim}" needs gazeRows`)
    }
  }

  for (const group of Object.keys(manifest.acts ?? {})) {
    for (const act of manifest.acts?.[group] ?? []) {
      if (!seen.has(act?.anim)) problems.push(`acts.${group}: unknown animation "${String(act?.anim)}"`)
      if (!(typeof act?.weight === 'number' && act.weight > 0)) problems.push(`acts.${group}: weight must be > 0`)
    }
  }
  return { ok: problems.length === 0, problems }
}

/**
 * Build the lookup structures the engine works with. Animations are resolved to
 * concrete grid indices so the hot drawing path does no schema work.
 */
export function indexManifest(manifest) {
  const sheets = manifest.sheets ?? {}
  const animations = new Map()
  for (const animation of manifest.animations ?? []) {
    const sheet = sheets[animation.sheet]
    if (sheet === undefined) continue
    const explicit = Array.isArray(animation.frames)
    const indices = explicit
      ? [...animation.frames]
      : rowIndices(sheet, { row: animation.row, frames: animation.frames ?? sheet.columns })
    const gazeRows = Array.isArray(animation.gazeRows) ? [...animation.gazeRows] : null
    animations.set(animation.id, {
      id: animation.id,
      sheet: animation.sheet,
      indices,
      gazeRows,
      fps: animation.fps,
      loop: animation.loop === true,
      optional: animation.optional === true,
      staticFrame: Number.isInteger(animation.staticFrame) ? animation.staticFrame : null,
      holdFrame: Number.isInteger(animation.holdFrame) ? animation.holdFrame : null,
      frameDurationsMs: Array.isArray(animation.frameDurationsMs) ? [...animation.frameDurationsMs] : null,
    })
  }
  return {
    version: manifest.version,
    sheets,
    animations,
    states: { ...(manifest.states ?? {}) },
    // Scenes are copied generically, like acts: a new composition is a manifest entry.
    scenes: Object.fromEntries(
      Object.entries(manifest.scenes ?? {}).map(([name, scene]) => [name, {
        ...scene,
        micros: [...(scene.micros ?? [])],
        ...(Array.isArray(scene.variants) ? { variants: scene.variants.map((variant) => ({ ...variant })) } : {}),
      }]),
    ),
    // Every act group is copied generically: a new group (working, night, …) needs no
    // code change here, only a manifest entry.
    acts: Object.fromEntries(
      Object.entries(manifest.acts ?? {}).map(([group, list]) => [group, [...(list ?? [])]]),
    ),
    toolActs: { ...(manifest.toolActs ?? {}) },
  }
}

/** Grid cell for one frame of an animation. */
export function cellFor(index, animation, sheet) {
  const frame = animation.indices[index]
  return {
    row: Math.floor(frame / sheet.columns),
    column: frame % sheet.columns,
  }
}

/** Grid cell for a gaze direction (0..15), optionally mirroring a short gaze strip. */
export function gazeCell(direction, animation, sheet, { mirror = false } = {}) {
  if (!Array.isArray(animation.gazeRows)) return null
  const rows = animation.gazeRows
  const half = rows.length * sheet.columns
  const size = mirror ? half * 2 : half
  const normalised = ((direction % size) + size) % size
  const mirrored = mirror && normalised >= half
  const frame = mirror ? normalised % half : normalised
  const row = rows[Math.floor(frame / sheet.columns)]
  if (!Number.isInteger(row) || row < 0 || row >= sheet.rows) return null
  return { row, column: frame % sheet.columns, flipX: mirrored }
}

/**
 * Frame index for a point in time; honours `loop` and the reduced-motion flag.
 * Reduced motion shows the animation's chosen static frame (a readable pose) instead
 * of whatever happens to be first — the old first-frame rule made many poses neutral.
 */
export function frameIndex(animation, elapsedMs, reducedMotion = false) {
  if (animation.indices.length <= 1) return 0
  if (reducedMotion) {
    const anchor = Number.isInteger(animation.staticFrame) ? animation.staticFrame : 0
    return Math.min(animation.indices.length - 1, Math.max(0, anchor))
  }
  // Authored timings win over fps: a strip may end with a long calm hold.
  const durations = animation.frameDurationsMs
  if (Array.isArray(durations) && durations.length === animation.indices.length) {
    const total = durations.reduce((sum, value) => sum + value, 0)
    let time = Math.max(0, elapsedMs)
    if (animation.loop) time %= total
    else if (time >= total) return Number.isInteger(animation.holdFrame) ? animation.holdFrame : animation.indices.length - 1
    let passed = 0
    for (let index = 0; index < durations.length; index += 1) {
      passed += durations[index]
      if (time < passed) return index
    }
    return animation.indices.length - 1
  }
  const step = Math.floor(Math.max(0, elapsedMs) * animation.fps / 1000)
  if (!animation.loop) {
    if (step >= animation.indices.length) return Number.isInteger(animation.holdFrame) ? animation.holdFrame : animation.indices.length - 1
    return step
  }
  return step % animation.indices.length
}

/** Natural duration of one animation pass, in milliseconds. */
export function animationDuration(animation) {
  if (animation === undefined || animation === null) return 0
  if (Array.isArray(animation.frameDurationsMs)) {
    return animation.frameDurationsMs.reduce((sum, value) => sum + value, 0)
  }
  if (!(animation.fps > 0)) return 0
  return (animation.indices.length / animation.fps) * 1000
}
