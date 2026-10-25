// Installed skins: each folder under lib/skins is a complete set of atlases plus a
// skin.json title. The system sources the art was generated from live separately under
// assets/source/<skin>/; this file only sees what ships.
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_SKIN } from '../settings/prefs.mjs'

export const SKINS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'skins')
export { DEFAULT_SKIN }

// Listing runs on every request; each problem is reported once, or the log would flood.
const reported = new Set()
function report(key, message) {
  if (reported.has(key)) return
  reported.add(key)
  console.warn(`big-fat-fish-girl: ${message}`)
}

/** Every installed skin, sorted by id, each `{ id, title, dir }`. */
export function listSkins(dir = SKINS_DIR) {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const skinDir = join(dir, entry.name)
        let title = entry.name
        try {
          const meta = JSON.parse(readFileSync(join(skinDir, 'skin.json'), 'utf8'))
          if (typeof meta.title === 'string' && meta.title !== '') title = meta.title
        } catch (error) {
          report(skinDir, `skin "${entry.name}" is skipped: ${error.message}`)
          return null
        }
        return { id: entry.name, title, dir: skinDir }
      })
      .filter((skin) => skin !== null)
      .sort((a, b) => a.id.localeCompare(b.id))
  } catch (error) {
    report(dir, `no skins can be read from ${dir}: ${error.message}`)
    return []
  }
}

/** The id of an installed skin; an unknown id falls back to the default. */
export function resolveSkin(id, dir = SKINS_DIR) {
  const skins = listSkins(dir)
  if (skins.some((skin) => skin.id === id)) return id
  if (skins.some((skin) => skin.id === DEFAULT_SKIN)) return DEFAULT_SKIN
  return skins.length > 0 ? skins[0].id : null
}
