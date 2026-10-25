// Interface text: locale parity, no hardcoded fallbacks, and the voice rules from
// plan §6.1 (no tickling, no "do not distract me", no "almost there", no "bored").
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { UI, UI_LOCALES, DEFAULT_UI_LOCALE, uiFor } from '../lib/i18n/strings.mjs'
import { LINES, LOCALES } from '../lib/i18n/lines.mjs'

test('у всех локалей одинаковый набор строк, и он совпадает с языками фраз', () => {
  const reference = Object.keys(UI[DEFAULT_UI_LOCALE]).sort()
  assert.ok(reference.length >= 2, 'минимум подписи меню оболочки')
  for (const locale of UI_LOCALES) {
    assert.deepEqual(Object.keys(UI[locale]).sort(), reference, `ключи локали ${locale}`)
    for (const [key, value] of Object.entries(UI[locale])) {
      assert.equal(typeof value, 'string', `${locale}.${key}`);
      assert.ok(value.trim().length > 0, `${locale}.${key} пуст`)
      const placeholders = (text) => [...text.matchAll(/\{[^}]+\}/g)].map(([match]) => match).sort()
      assert.deepEqual(placeholders(value), placeholders(UI[DEFAULT_UI_LOCALE][key]), `${locale}.${key}: плейсхолдеры`)
    }
  }
  // Список языков один: строки интерфейса и фразы не должны разъезжаться.
  assert.deepEqual(UI_LOCALES, LOCALES)
})

test('uiFor переживает неизвестную и отсутствующую локаль', () => {
  assert.equal(DEFAULT_UI_LOCALE, 'en')
  assert.equal(uiFor('en'), UI.en)
  assert.equal(uiFor('ru'), UI.ru)
  assert.equal(uiFor('zh-CN'), UI['zh-CN'])
  assert.equal(uiFor('de'), UI.en)
  assert.equal(uiFor(undefined), UI.en)
})

test('голос персонажа не нарушает правила плана §6.1', () => {
  const banned = [
    'щекот', 'tickle',
    'не мешай', 'do not distract',
    'ещё чуть-чуть', 'almost there',
    'скучно', 'bored',
    'не буди', 'do not wake',
    '挠痒', '别打扰', '马上就好', '无聊', '别叫醒',
  ]
  for (const locale of LOCALES) {
    const pools = LINES[locale]
    for (const [pool, lines] of Object.entries(pools)) {
      for (const line of lines) {
        const lower = line.toLowerCase()
        for (const phrase of banned) {
          assert.equal(
            lower.includes(phrase),
            false,
            `${locale}.${pool}: «${line}» содержит запрещённое «${phrase}»`,
          )
        }
      }
    }
  }
})
