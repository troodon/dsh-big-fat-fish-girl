// Interface text lookup. Keep product strings out of the components: they read
// `uiFor(locale)` and a new language is one more file with the same keys.
import { UI_RU } from './ui.ru.mjs'
import { UI_EN } from './ui.en.mjs'
import { UI_ZH_CN } from './ui.zh-CN.mjs'

export const UI = Object.freeze({ ru: UI_RU, en: UI_EN, 'zh-CN': UI_ZH_CN })
export const UI_LOCALES = Object.freeze(Object.keys(UI))
export const DEFAULT_UI_LOCALE = 'en'

export function uiFor(locale) {
  return UI[locale] ?? UI[DEFAULT_UI_LOCALE]
}
