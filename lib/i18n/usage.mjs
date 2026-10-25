// Token counts as a details line: numbers from the provider, never invented money.
import { uiFor } from './strings.mjs'

function formatTokens(locale, value) {
  try {
    const numberLocale = { ru: 'ru-RU', 'zh-CN': 'zh-CN' }[locale] ?? 'en-US'
    return new Intl.NumberFormat(numberLocale).format(value)
  } catch {
    return String(value)
  }
}

/** A localized tooltip for the wallet bubble; empty when there is nothing real to show. */
export function usageTitle(locale, usage) {
  if (usage === null || usage === undefined || !Number.isFinite(usage.totalTokens)) return ''
  const ui = uiFor(locale)
  return ui.usageTitle
    .replace('{total}', formatTokens(locale, usage.totalTokens))
    .replace('{input}', formatTokens(locale, usage.inputTokens))
    .replace('{output}', formatTokens(locale, usage.outputTokens))
}
