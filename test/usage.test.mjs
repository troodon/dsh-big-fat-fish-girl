// Token tooltips: real numbers only, localized, empty when there is nothing real.
import test from 'node:test'
import assert from 'node:assert/strict'
import { usageTitle } from '../lib/i18n/usage.mjs'

test('usageTitle форматирует числа и локализует подписи', () => {
  const ru = usageTitle('ru', { totalTokens: 12345, inputTokens: 10000, outputTokens: 2345 })
  assert.match(ru, /12\s?345/)
  assert.match(ru, /10\s?000/)
  assert.match(ru, /2\s?345/)
  const en = usageTitle('en', { totalTokens: 12345, inputTokens: 10000, outputTokens: 2345 })
  assert.match(en, /12,345/)
  assert.match(en, /Last job/)
  const zh = usageTitle('zh-CN', { totalTokens: 12345, inputTokens: 10000, outputTokens: 2345 })
  assert.match(zh, /12,345/)
  assert.match(zh, /最近一次任务/)
  assert.match(zh, /个 Token（输入 10,000，输出 2,345）/)
})

test('usageTitle пуст, когда числа не пришли', () => {
  assert.equal(usageTitle('ru', null), '')
  assert.equal(usageTitle('ru', undefined), '')
  assert.equal(usageTitle('ru', {}), '')
})
