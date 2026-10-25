import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import z from '@deepseek-ai/schemastery'
import { createPetModel, applySessionEvent } from './model.mjs'
import { snapshotFor } from './snapshot.mjs'
import { openAttention } from './aggregate.mjs'
import { TRACKED_EVENTS } from './host-adapter.mjs'
import { LOCALES } from '../i18n/lines.mjs'
import { DEFAULT_PREFS, PREFS_LIMITS, readPrefs } from '../settings/prefs.mjs'
import { desktopPageUrl, ensureShell, resolveShellBinary } from './shell-launch.mjs'
import { createShellPresence } from './shell-presence.mjs'
import { createLiveChannel } from './live-channel.mjs'
import { createHostRoutes, EVENTS_PATH } from './host-routes.mjs'
import { DEFAULT_SKIN, listSkins, resolveSkin } from './skins.mjs'
import { reportOnce } from '../diagnostics.mjs'

export const name = 'big-fat-fish-girl'
export const inject = ['webServer', 'sessions']

/** The skins installed next to this file; the Config union is built from them. */
const SKIN_IDS = listSkins().map((skin) => skin.id)

/**
 * The plugin's settings schema. Harness renders it in its own settings UI (Plugins →
 * Installed → this plugin) and stores the values in the profile config; changing a value
 * re-applies the plugin and the page picks the new prefs up from the next snapshot.
 */
export const Config = z.object({
  size: z.number().role('slider')
    .min(PREFS_LIMITS.size.min).max(PREFS_LIMITS.size.max).step(2)
    .default(DEFAULT_PREFS.size).volatile()
    .description('Pet width, 88–172 CSS px.'),
  opacity: z.number().role('slider')
    .min(PREFS_LIMITS.opacity.min).max(PREFS_LIMITS.opacity.max).step(0.05)
    .default(DEFAULT_PREFS.opacity).volatile()
    .description('Pet opacity, 0.35–1.'),
  reducedMotion: z.boolean().default(DEFAULT_PREFS.reducedMotion).volatile()
    .description('Hold each state\'s readable still frame instead of animating.'),
  hover: z.boolean().default(DEFAULT_PREFS.hover).volatile()
    .description('React to the cursor entering the pet.'),
  randomActs: z.boolean().default(DEFAULT_PREFS.randomActs).volatile()
    .description('Spontaneous idle scenes when nothing is happening.'),
  meal: z.boolean().default(DEFAULT_PREFS.meal).volatile()
    .description('A short snack after a long stretch of work.'),
  wallet: z.boolean().default(DEFAULT_PREFS.wallet).volatile()
    .description('A wallet check after a completed job.'),
  wander: z.boolean().default(DEFAULT_PREFS.wander).volatile()
    .description('Rare autonomous strolls (about twice an hour at most).'),
  locale: z.union(LOCALES).default(DEFAULT_PREFS.locale).volatile()
    .description('Language of the pet\'s bubbles.'),
  skin: z.union(SKIN_IDS.length > 0 ? SKIN_IDS : [DEFAULT_SKIN]).default(DEFAULT_SKIN).volatile()
    .description('Which installed skin draws the pet.'),
  autoStartShell: z.boolean().default(true)
    .description('Start the desktop shell together with Harness and stop it when Harness exits.'),
  shellPath: z.string().default('')
    .description('Optional path to the desktop shell app or binary; detected automatically by default.'),
})

/** The plugin lives in <root>/lib/host; the shell build output lives under <root>/desktop. */
const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const TRACKED = new Set(TRACKED_EVENTS)

/**
 * Replay live sessions so a cold start does not pretend to be idle.
 *
 * DeepSeek Harness 0.2.0-rc.2 no longer exposes `session.events`: a live Session has
 * `log` (ordered events), `seq` and `eventAt(seq)`. Replay is anonymised by the
 * adapter — only status edges survive. Host snapshots remain optional; the live
 * stream stays authoritative.
 */
function hydrate(model, sessions) {
  try {
    const list = typeof sessions?.list === 'function' ? sessions.list() : []
    for (const session of list) {
      const log = Array.isArray(session?.log)
        ? session.log
        : (typeof session?.eventAt === 'function' && Number.isInteger(session?.seq)
          ? Array.from({ length: session.seq }, (_, seq) => session.eventAt(seq))
          : null)
      if (log === null) continue
      for (const event of log) {
        if (event !== null && event !== undefined && TRACKED.has(event.type)) {
          applySessionEvent(model, session, event, 0)
        }
      }
    }
  } catch (error) {
    // The live stream still works without a replay, but a failed replay must stay visible.
    console.warn('big-fat-fish-girl: could not replay live sessions:', error?.message ?? error)
  }
}

export function apply(ctx, config) {
  ctx.effect(() => {
    // The configured skin might not be installed; snap it to what actually ships.
    const currentPrefs = () => {
      const next = readPrefs(config)
      next.skin = resolveSkin(next.skin) ?? DEFAULT_SKIN
      return next
    }
    let prefs = currentPrefs()
    const model = createPetModel()
    const cleanups = []
    let shellWatch = null
    const webServer = typeof ctx.get === 'function' ? ctx.get('webServer') : undefined
    const sessions = typeof ctx.get === 'function' ? ctx.get('sessions') : undefined
    hydrate(model, sessions)
    // The shell is a separate artifact. When one is installed, start it with Harness and
    // stop exactly the process started here; a shell launched by hand is left alone.
    // Disabling the setting re-applies the plugin, which disposes this one first.
    // Only launch when the host actually passed an options object (a real Harness
    // apply). Tests and tools that call apply() bare must never start a GUI process.
    //
    // Harness 0.2.1 binds the web server to an OS-assigned port, so discovery on the
    // old fixed port would find nothing: the shell is told the page URL directly.
    // Hosts without `getOrigin` keep the shell's own discovery (desktopPageUrl → null).
    const pageUrl = desktopPageUrl(webServer)
    const shell = ensureShell({
      autoStart: config !== null && typeof config === 'object' && config.autoStartShell !== false,
      binary: resolveShellBinary({
        platform: process.platform,
        pluginRoot: PLUGIN_ROOT,
        configured: typeof config?.shellPath === 'string' ? config.shellPath : '',
      }),
      args: pageUrl === null ? [] : ['--url', pageUrl],
    })

    const presence = createShellPresence({ shellStarted: shell.started })
    // Every snapshot carries the settings as the plugin currently holds them, so both
    // surfaces apply size/opacity/behaviour without keeping their own copies.
    const publish = () => ({ ...snapshotFor(model), prefs, shellActive: presence.publish() })
    const channel = createLiveChannel({ snapshot: publish, presence })

    // Volatile fields are replaced in place by the host: no remount, just new values.
    ctx.effect(() => ctx.on('loader/volatile-update', () => {
      prefs = currentPrefs()
      channel.sendSnapshot()
    }), 'Big Fat Fish Girl: live settings')
    const onSessionEvent = (session, event) => {
      if (!TRACKED.has(event?.type)) return
      applySessionEvent(model, session, event)
      channel.sendSnapshot()
    }
    const offEvents = ctx.on('session/event', onSessionEvent)
    if (typeof offEvents === 'function') cleanups.push(offEvents)

    if (webServer && typeof webServer.register === 'function') {
      for (const route of createHostRoutes({
        publish,
        // An opaque request ref only. It never carries prompt, tool or file content, and
        // the route accepts only refs that are open right now (allow-list).
        broadcastNavigate: (targetRef) => channel.sendNavigate(targetRef),
        isTargetOpen: (targetRef) => openAttention(model).some((item) => item.targetRef === targetRef),
        activeSkin: () => prefs.skin,
      })) {
        const dispose = webServer.register(route)
        if (typeof dispose === 'function') cleanups.push(dispose)
      }

      const disposeEvents = webServer.register({
        kind: 'exact',
        path: EVENTS_PATH,
        handler: (req, res) => channel.connect(req, res),
      })
      if (typeof disposeEvents === 'function') cleanups.push(disposeEvents)

      // The shell can exit on its own (crash, Cmd+Q): the overlay comes back shortly
      // after the grace window, without waiting for a re-apply.
      shellWatch = setInterval(() => {
        if (presence.changed()) channel.sendSnapshot()
      }, 5000)
      if (typeof shellWatch.unref === 'function') shellWatch.unref()
    }

    return () => {
      shell.dispose()
      if (shellWatch !== null) clearInterval(shellWatch)
      channel.closeAll()
      for (const cleanup of cleanups.reverse()) {
        try { cleanup() } catch (error) { reportOnce('a route did not unregister', error) }
      }
    }
  }, 'Big Fat Fish Girl: event bridge and local atlas routes')
}
