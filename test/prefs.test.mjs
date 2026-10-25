// Preferences: one source of defaults, validation, and the plugin Config schema.
import test from 'node:test'
import assert from 'node:assert/strict'
import { Config } from '../lib/host/index.mjs'
import { DEFAULT_PREFS, PREFS_LIMITS, normalisePrefs, readPrefs, samePrefs } from '../lib/settings/prefs.mjs'

test('normalisePrefs возвращает дефолты из пустого входа', () => {
  assert.equal(DEFAULT_PREFS.skin, 'deepseek-chan')
  assert.equal(DEFAULT_PREFS.locale, 'en')
  assert.deepEqual(normalisePrefs(undefined), { ...DEFAULT_PREFS })
  assert.deepEqual(normalisePrefs(null), { ...DEFAULT_PREFS })
  assert.deepEqual(normalisePrefs('нет'), { ...DEFAULT_PREFS })
})

test('normalisePrefs зажимает числа и терпит мусор', () => {
  assert.equal(normalisePrefs({ size: 4 }).size, PREFS_LIMITS.size.min)
  assert.equal(normalisePrefs({ size: 9999 }).size, PREFS_LIMITS.size.max)
  assert.equal(normalisePrefs({ size: 131.6 }).size, 132, 'округляется')
  assert.equal(normalisePrefs({ opacity: 0 }).opacity, PREFS_LIMITS.opacity.min)
  assert.equal(normalisePrefs({ opacity: 2 }).opacity, 1)
  assert.equal(normalisePrefs({ opacity: 'нет' }).opacity, DEFAULT_PREFS.opacity)
  assert.equal(normalisePrefs({ locale: 'de' }).locale, DEFAULT_PREFS.locale)
  assert.equal(normalisePrefs({ locale: 'en' }).locale, 'en')
  assert.equal(normalisePrefs({ locale: 'zh-CN' }).locale, 'zh-CN')
  assert.equal(normalisePrefs({ skin: 'other-skin' }).skin, 'other-skin', 'скин принимается как есть')
  assert.equal(normalisePrefs({ skin: '' }).skin, DEFAULT_PREFS.skin)
  assert.equal(normalisePrefs({ skin: 42 }).skin, DEFAULT_PREFS.skin, 'не строка — дефолт')
  assert.equal(normalisePrefs({ hover: 'да' }).hover, DEFAULT_PREFS.hover, 'не boolean — дефолт')
})

test('samePrefs замечает только значимые изменения', () => {
  assert.equal(samePrefs(DEFAULT_PREFS, { ...DEFAULT_PREFS }), true)
  assert.equal(samePrefs(DEFAULT_PREFS, { ...DEFAULT_PREFS, size: 96 }), false)
  assert.equal(samePrefs(DEFAULT_PREFS, { ...DEFAULT_PREFS, skin: 'other-skin' }), false)
  assert.equal(samePrefs(DEFAULT_PREFS, null), false)
})

test('readPrefs разворачивает volatile-ссылки хоста', () => {
  const live = (value) => ({ get: () => value })
  assert.deepEqual(readPrefs({ size: live(150), locale: live('en'), hover: live(false) }),
    { ...DEFAULT_PREFS, size: 150, locale: 'en', hover: false })
  assert.deepEqual(readPrefs(undefined), { ...DEFAULT_PREFS })
})

test('Config — та же схема и те же дефолты, что и у нормализатора', () => {
  // Поля помечены volatile: хост отдаёт их живыми ссылками, значения читает readPrefs.
  assert.deepEqual(readPrefs(Config({})), { ...DEFAULT_PREFS })
  assert.deepEqual(readPrefs(Config({ size: 160, locale: 'en' })), { ...DEFAULT_PREFS, size: 160, locale: 'en' })
  assert.deepEqual(readPrefs(Config({ locale: 'zh-CN' })), { ...DEFAULT_PREFS, locale: 'zh-CN' })
  // Схема — строгий валидатор для формы настроек: вне диапазона и не тот тип отклоняются
  // (страница получает уже нормализованные значения, поэтому зажим делает normalisePrefs).
  assert.throws(() => Config({ size: 9999 }), 'размер вне диапазона отклоняется')
  assert.throws(() => Config({ opacity: 0 }), 'прозрачность вне диапазона отклоняется')
  assert.throws(() => Config({ locale: 'de' }), 'неизвестная локаль отклоняется схемой')
  assert.throws(() => Config({ hover: 'да' }), 'строка вместо boolean отклоняется')
})
