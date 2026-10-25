// Text bubblines: which pool a state speaks from, how often it rotates, and how a
// line is picked. Pure data + pure functions so both the page overlay and a future
// desktop shell share exactly the same voice.
import { RU } from './lines.ru.mjs'
import { EN } from './lines.en.mjs'
import { ZH_CN } from './lines.zh-CN.mjs'
import { uiFor } from './strings.mjs'

export const LINES = Object.freeze({ ru: RU, en: EN, 'zh-CN': ZH_CN })
export const LOCALES = Object.freeze(Object.keys(LINES))
export const DEFAULT_LOCALE = 'en'

export function linesFor(locale, pool) {
  const dictionary = LINES[locale] ?? LINES[DEFAULT_LOCALE]
  const lines = dictionary?.[pool]
  return Array.isArray(lines) ? lines : []
}

/**
 * Pick a line. `avoid` (usually the previous line) is skipped while alternatives
 * exist, so the pet does not repeat itself twice in a row.
 */
export function pickLine(locale, pool, random = Math.random, avoid = null) {
  const lines = linesFor(locale, pool)
  if (lines.length === 0) return null
  const candidates = lines.length > 1 && avoid !== null ? lines.filter((line) => line !== avoid) : lines
  const source = candidates.length > 0 ? candidates : lines
  return source[Math.min(source.length - 1, Math.floor(random() * source.length))]
}

/**
 * The compact team bubble over the pinned task, or null when no helper is known.
 * Counts come from the snapshot; the wording lives in the interface strings.
 */
export function teamStatusLine(locale, team) {
  const ui = uiFor(locale)
  const states = [
    [team.active, ui.teamActive],
    [team.waiting, ui.teamWaiting],
    [team.completed, ui.teamCompleted],
    [team.errors, ui.teamErrors],
  ]
  const summary = states
    .filter(([count]) => count > 0)
    .map(([count, template]) => template.replace('{count}', String(count)))
    .join(' · ')
  return summary === '' ? null : ui.teamTitle.replace('{summary}', summary)
}
