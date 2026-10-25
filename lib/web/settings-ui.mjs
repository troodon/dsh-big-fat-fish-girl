// Our own settings section inside Harness's Settings panel.
//
// The generic config form renders numbers as plain inputs and has no slider, so the pet
// ships a small section built on the documented slot (`settings.section`) and the shared
// configuration service (`configForms.get(namespace)`, `form.set(field, value)`), which
// writes to the profile config live — every change applies immediately.
//
// React comes from the host through the module loader's `require`; if it is not there
// (an older host, the preview playground, tests), registration is skipped and the pet
// keeps working.
import { readPrefs, PREFS_LIMITS } from '../settings/prefs.mjs'
import { API } from './surface.mjs'
import { reportOnce } from '../diagnostics.mjs'
import { uiFor } from '../i18n/strings.mjs'

export const SETTINGS_NAMESPACE = 'big-fat-fish-girl'

/** Leading/trailing write interval while a slider is dragged (ms). */
export const WRITE_THROTTLE_MS = 140

function controlRow(React, ui, key, label, control, output) {
  return React.createElement(
    'label',
    { key, style: { display: 'grid', gridTemplateColumns: '1fr auto', gap: '2px 12px', alignItems: 'center' } },
    React.createElement('span', null, label),
    output === undefined ? null : React.createElement('output', { style: { opacity: 0.7 } }, output),
    React.createElement('div', { style: { gridColumn: '1 / -1' } }, control),
  )
}

function toggleRow(React, key, label, checked, disabled, onChange) {
  return React.createElement(
    'label',
    { key, style: { display: 'flex', gap: 10, alignItems: 'center' } },
    React.createElement('input', { type: 'checkbox', checked, disabled, onChange: (event) => onChange(event.target.checked) }),
    React.createElement('span', null, label),
  )
}

/** Build the React component; kept separate so the module stays testable without React. */
export function createSettingsView(React, form) {
  return function BigFatFishGirlSettings() {
    const subscribe = React.useCallback((listener) => form.subscribe(listener), [])
    const getSnapshot = React.useCallback(() => form.getSnapshot(), [])
    const state = React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
    const prefs = readPrefs(state.value)
    const ui = uiFor(prefs.locale)
    const ready = state.status === 'ready'
    const disabled = !ready || state.writable === false

    // Dragging a slider must not queue one host write per pixel: keep the thumb local
    // (draft) and throttle writes, sending a leading value and one trailing value.
    // Without this the committed values trickle back for seconds after the mouse stops.
    const [draft, setDraft] = React.useState({})
    const pending = React.useRef({})
    const timers = React.useRef({})
    const lastSent = React.useRef({})
    // The installed skins come from the host; until they arrive the current one is the
    // only option, so the row never renders empty.
    const [skins, setSkins] = React.useState([])
    React.useEffect(() => {
      let alive = true
      fetch(`${API}/skins`)
        .then((response) => (response.ok ? response.json() : null))
        .then((list) => { if (alive && Array.isArray(list) && list.length > 0) setSkins(list) })
        .catch((error) => reportOnce('skin list unavailable', error))
      return () => { alive = false }
    }, [])

    const send = (field, value) => {
      const now = Date.now()
      const since = now - (lastSent.current[field] ?? 0)
      if (since >= WRITE_THROTTLE_MS) {
        lastSent.current[field] = now
        pending.current[field] = undefined
        form.set(field, value)
        return
      }
      pending.current[field] = value
      if (!timers.current[field]) {
        timers.current[field] = setTimeout(() => {
          timers.current[field] = 0
          const next = pending.current[field]
          if (next === undefined) return
          lastSent.current[field] = Date.now()
          pending.current[field] = undefined
          form.set(field, next)
        }, WRITE_THROTTLE_MS - since)
      }
    }
    const flush = (field) => {
      if (timers.current[field]) {
        clearTimeout(timers.current[field])
        timers.current[field] = 0
      }
      const next = pending.current[field]
      if (next === undefined) return
      pending.current[field] = undefined
      lastSent.current[field] = Date.now()
      form.set(field, next)
    }
    const live = (field, value) => {
      setDraft((current) => ({ ...current, [field]: value }))
      send(field, value)
    }
    const settle = (field) => {
      flush(field)
      setDraft((current) => {
        if (current[field] === undefined) return current
        const next = { ...current }
        delete next[field]
        return next
      })
    }
    // A confirmed value that matches the draft clears it; the slider then follows the host.
    React.useEffect(() => {
      setDraft((current) => {
        let changed = false
        const next = { ...current }
        for (const key of Object.keys(next)) {
          if (prefs[key] === next[key]) {
            delete next[key]
            changed = true
          }
        }
        return changed ? next : current
      })
    })
    const valueOf = (field) => (draft[field] === undefined ? prefs[field] : draft[field])

    const slider = (field, label, min, max, step, format) => controlRow(React, ui, field, label,
      React.createElement('input', {
        type: 'range',
        min: String(min),
        max: String(max),
        step: String(step),
        value: valueOf(field),
        disabled,
        style: { width: '100%' },
        onChange: (event) => live(field, Number(event.target.value)),
        onPointerUp: () => settle(field),
        onKeyUp: () => settle(field),
        onBlur: () => settle(field),
      }),
      format(valueOf(field)),
    )

    // Shell lifecycle is host-level (not a pet pref): read it off the raw config state,
    // write it straight back, and Harness re-applies the plugin to start or stop it.
    const autoStartShell = state.value?.autoStartShell !== false
    const rows = [
      slider('size', ui.size, PREFS_LIMITS.size.min, PREFS_LIMITS.size.max, 2, (value) => `${value} px`),
      slider('opacity', ui.opacity, PREFS_LIMITS.opacity.min, PREFS_LIMITS.opacity.max, 0.05,
        (value) => `${Math.round(value * 100)}%`),
      controlRow(React, ui, 'locale', ui.locale,
        React.createElement('select', {
          value: valueOf('locale'),
          disabled,
          onChange: (event) => form.set('locale', event.target.value),
        },
        React.createElement('option', { value: 'ru' }, 'Русский'),
        React.createElement('option', { value: 'en' }, 'English'),
        React.createElement('option', { value: 'zh-CN' }, '简体中文')),
      ),
      controlRow(React, ui, 'skin', ui.skin,
        React.createElement('select', {
          value: valueOf('skin'),
          disabled,
          onChange: (event) => form.set('skin', event.target.value),
        },
        ...(skins.length > 0 ? skins : [{ id: valueOf('skin'), title: valueOf('skin') }])
          .map((skin) => React.createElement('option', { key: skin.id, value: skin.id }, skin.title)))),
      toggleRow(React, 'reducedMotion', ui.reducedMotion, Boolean(valueOf('reducedMotion')), disabled, (value) => form.set('reducedMotion', value)),
      toggleRow(React, 'hover', ui.hover, Boolean(valueOf('hover')), disabled, (value) => form.set('hover', value)),
      toggleRow(React, 'randomActs', ui.randomActs, Boolean(valueOf('randomActs')), disabled, (value) => form.set('randomActs', value)),
      toggleRow(React, 'meal', ui.meal, Boolean(valueOf('meal')), disabled, (value) => form.set('meal', value)),
      toggleRow(React, 'wallet', ui.wallet, Boolean(valueOf('wallet')), disabled, (value) => form.set('wallet', value)),
      toggleRow(React, 'wander', ui.wander, Boolean(valueOf('wander')), disabled, (value) => form.set('wander', value)),
      toggleRow(React, 'autoStartShell', ui.autoStartShell, autoStartShell, disabled, (value) => form.set('autoStartShell', value)),
    ]

    return React.createElement(
      'section',
      { style: { display: 'grid', gap: 12, maxWidth: 560, color: 'var(--dsw-alias-label-primary, inherit)' } },
      React.createElement('p', { style: { margin: 0, opacity: 0.7, fontSize: 13 } },
        ready ? ui.settingsIntro : ui.loading),
      ...rows,
    )
  }
}

/**
 * Register the section when the host provides slots and the shared config forms.
 * @returns a disposer, or null when the host cannot show it.
 */
export function registerSettings(ctx) {
  const skip = (reason) => {
    try { globalThis.__BFFG_SETTINGS__ = 'skipped: ' + reason } catch {}
    return null
  }
  try {
    if (typeof require !== 'function') return skip('no module require')
    let React = null
    try { React = require('react') } catch { React = null }
    if (React === null || React === undefined || typeof React.createElement !== 'function') return skip('react unavailable')
    const get = (name) => (typeof ctx?.get === 'function' ? ctx.get(name) : ctx?.[name])
    const slots = get('slots')
    const configForms = get('configForms')
    if (slots === null || slots === undefined || typeof slots.inject !== 'function') return skip('no slots service')
    if (configForms === null || configForms === undefined || typeof configForms.get !== 'function') return skip('no configForms service')
    const form = configForms.get(SETTINGS_NAMESPACE)
    const component = createSettingsView(React, form)
    const disposer = slots.inject('settings.section', () => slots.register({
      name: 'settings.section',
      id: SETTINGS_NAMESPACE,
      order: 50,
      label: 'Big Fat Fish Girl',
    }, component))
    try { globalThis.__BFFG_SETTINGS__ = 'registered' } catch {}
    return disposer
  } catch (error) {
    try { globalThis.__BFFG_SETTINGS__ = 'failed: ' + String(error) } catch {}
    return null
  }
}

/** Attach the section once the host services exist (dynamic injection, older hosts skip). */
export function attachSettings(ctx) {
  try {
    if (typeof ctx?.inject === 'function') {
      ctx.inject(['slots', 'configForms'], () => registerSettings(ctx))
      return
    }
  } catch {}
  registerSettings(ctx)
}
