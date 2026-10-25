// The plugin's HTTP surface: snapshot, sheets, skins, manifest, desktop page and the
// allow-listed navigate command. Kept apart from the plugin wiring so the routes can
// be read without the event stream, the shell lifecycle or the web server setup.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { API_PREFIX } from '../protocol/contract.mjs'
import { DEFAULT_MANIFEST } from '../animation/manifest.mjs'
import { reportOnce } from '../diagnostics.mjs'
import { skinSheetUrl } from '../animation/sheets.mjs'
import { DEFAULT_SKIN, listSkins, resolveSkin } from './skins.mjs'

const API = API_PREFIX
export const EVENTS_PATH = API + '/events'
const STATE_PATH = API + '/state'
const ATLAS_PATH = API + '/atlas.png'
const MANIFEST_PATH = API + '/manifest'
const DESKTOP_PATH = API + '/desktop'
const NAVIGATE_PATH = API + '/navigate'
const SKINS_PATH = API + '/skins'
// The webserver matches a prefix route as `${path}/…`, so the registered paths must
// carry no trailing slash; the handlers strip it back off.
const SHEET_PATH = API + '/sheet'
const SKIN_PATH = API + '/skin'
/** Sheet files the manifest declares — the only names the sheet routes will serve. */
const SHEET_FILES = new Set(Object.values(DEFAULT_MANIFEST.sheets).map((sheet) => sheet.file))
/** Bound the navigate request body: a target ref is a short opaque string. */
const NAVIGATE_BODY_LIMIT = 4096

function readJsonBody(req) {
  return new Promise((resolve) => {
    let raw = ''
    req.on('data', (chunk) => {
      raw += chunk
      if (raw.length > NAVIGATE_BODY_LIMIT) req.destroy()
    })
    req.on('end', () => {
      try { resolve(JSON.parse(raw === '' ? '{}' : raw)) } catch { resolve(null) }
    })
    req.on('error', () => resolve(null))
    // A destroyed or aborted request never emits `end`; resolve so the handler stops.
    req.on('close', () => resolve(null))
  })
}

/** Whether the body is declared as JSON; a cross-site form cannot send that without a preflight. */
function isJson(req) {
  return /^application\/json(?:;|$)/i.test(req.headers?.['content-type'] ?? '')
}

function sendJson(res, status, value, headers = {}) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...headers,
  })
  res.end(JSON.stringify(value))
}

/**
 * The status for a file that cannot be read. A missing file is a 404; anything else is a
 * fault (a directory where the atlas should be, a permission problem) and answers 500.
 */
export function readErrorStatus(error) {
  return error?.code === 'ENOENT' ? 404 : 500
}

/** Serve one whitelisted PNG; HEAD gets the headers only. */
function servePng(req, res, file) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD' })
    return res.end()
  }
  try {
    const image = readFileSync(file)
    res.writeHead(200, {
      'content-type': 'image/png',
      'content-length': image.length,
      'cache-control': 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
    })
    res.end(req.method === 'HEAD' ? undefined : image)
  } catch (error) {
    if (error?.code !== 'ENOENT') reportOnce(`sheet ${file} cannot be read`, error)
    res.writeHead(readErrorStatus(error))
    res.end()
  }
}

/**
 * The manifest as one skin consumes it: every sheet gets the URL under that skin, so
 * an external shell can load the pixels without knowing how skins are laid out.
 */
export function manifestForSkin(skinId, dir) {
  const skin = resolveSkin(skinId, dir)
  const sheets = Object.fromEntries(
    Object.entries(DEFAULT_MANIFEST.sheets).map(([id, sheet]) => [id, {
      ...sheet,
      url: skinSheetUrl(skin, sheet),
    }]),
  )
  return { ...DEFAULT_MANIFEST, sheets }
}

/**
 * @param options.publish current snapshot with the plugin-held prefs
 * @param options.broadcastNavigate `(targetRef)` — tell every in-page client
 * @param options.isTargetOpen `(targetRef) => boolean` — the navigate allow-list
 * @param options.activeSkin `() => string` — the skin the settings select
 * @param options.skinsDir where skins live (tests pass a fixture directory)
 * @returns route descriptions for `webServer.register`
 */
export function createHostRoutes({
  publish, broadcastNavigate, isTargetOpen,
  activeSkin = () => DEFAULT_SKIN, skinsDir,
}) {
  const installedSkins = () => listSkins(skinsDir)
  const exactSkin = (id) => installedSkins().find((skin) => skin.id === id) ?? null
  // The configured skin may not be installed (a package replaced under the config):
  // fall back to the first installed one so the page always has art.
  const activeEntry = () => exactSkin(resolveSkin(activeSkin(), skinsDir)) ?? installedSkins()[0] ?? null

  return [
    {
      kind: 'exact',
      path: STATE_PATH,
      handler: (req, res) => {
        if (req.method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' }, { allow: 'GET' })
        sendJson(res, 200, publish())
      },
    },
    {
      kind: 'exact',
      path: SKINS_PATH,
      handler: (req, res) => {
        if (req.method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' }, { allow: 'GET' })
        sendJson(res, 200, listSkins(skinsDir).map(({ id, title }) => ({ id, title })))
      },
    },
    {
      kind: 'exact',
      path: ATLAS_PATH,
      handler: (req, res) => {
        const skin = activeEntry()
        if (skin === null) {
          res.writeHead(404)
          return res.end()
        }
        servePng(req, res, join(skin.dir, DEFAULT_MANIFEST.sheets.base.file))
      },
    },
    {
      kind: 'prefix',
      path: SHEET_PATH,
      handler: (req, res) => {
        // The pre-skin URL shape: resolve against the active skin.
        const name = fileAfter(req, res, SHEET_PATH)
        if (name === null) return
        if (!SHEET_FILES.has(name)) {
          res.writeHead(404)
          return res.end()
        }
        const skin = activeEntry()
        if (skin === null) {
          res.writeHead(404)
          return res.end()
        }
        servePng(req, res, join(skin.dir, name))
      },
    },
    {
      kind: 'prefix',
      path: SKIN_PATH,
      handler: (req, res) => {
        // /skin/<id>/<file>: the id must name an installed skin, the file must be one
        // the manifest declares, so a crafted path can never leave the skins folder.
        const rest = fileAfter(req, res, SKIN_PATH)
        if (rest === null) return
        const slash = rest.indexOf('/')
        const requested = slash === -1 ? '' : rest.slice(0, slash)
        const name = slash === -1 ? '' : rest.slice(slash + 1)
        const skin = exactSkin(requested)
        if (skin === null || !SHEET_FILES.has(name)) {
          res.writeHead(404)
          return res.end()
        }
        servePng(req, res, join(skin.dir, name))
      },
    },
    {
      kind: 'exact',
      path: MANIFEST_PATH,
      handler: (req, res) => {
        if (req.method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' }, { allow: 'GET' })
        sendJson(res, 200, manifestForSkin(activeSkin(), skinsDir))
      },
    },
    {
      kind: 'exact',
      path: DESKTOP_PATH,
      handler: (req, res) => {
        if (req.method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' }, { allow: 'GET' })
        try {
          const page = readFileSync(new URL('../../desktop/pet.html', import.meta.url))
          res.writeHead(200, {
            'content-type': 'text/html; charset=utf-8',
            'content-length': page.length,
            'cache-control': 'no-store',
            'x-content-type-options': 'nosniff',
          })
          res.end(page)
        } catch (error) {
          // The page is a build artifact: say so once, and answer 503 instead of a blank window.
          reportOnce('desktop page missing; run npm run build:desktop', error)
          res.writeHead(503)
          res.end()
        }
      },
    },
    // The desktop shell asks for navigation here; every in-page client performs it.
    // Accepted refs are limited to requests that are open right now, so a stray POST
    // cannot navigate anywhere else.
    {
      kind: 'exact',
      path: NAVIGATE_PATH,
      handler: async (req, res) => {
        if (req.method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' }, { allow: 'POST' })
        // Any page can send a text/plain POST without a preflight; only the pet's own pages send JSON.
        if (!isJson(req)) return sendJson(res, 415, { error: 'content-type must be application/json' })
        const body = await readJsonBody(req)
        const targetRef = body !== null && typeof body.targetRef === 'string' ? body.targetRef : null
        if (targetRef === null || targetRef === '') {
          return sendJson(res, 400, { error: 'targetRef is required' })
        }
        if (!isTargetOpen(targetRef)) return sendJson(res, 409, { error: 'unknown or resolved target' })
        broadcastNavigate(targetRef)
        sendJson(res, 200, { ok: true })
      },
    },
  ]
}

/** The path after a prefix route, or null after answering 404/400 itself. */
function fileAfter(req, res, prefix) {
  try {
    const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://dsh.internal').pathname)
    if (!pathname.startsWith(`${prefix}/`)) {
      res.writeHead(404)
      return null
    }
    return pathname.slice(prefix.length + 1)
  } catch {
    res.writeHead(400)
    return null
  }
}
