// Phrase pools: key parity between locales, deterministic picking, team summary.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_LOCALE, LINES, LOCALES, linesFor, pickLine, teamStatusLine } from '../lib/i18n/lines.mjs'

test('во всех локалях одинаковый набор пулов и непустые строки', () => {
  const reference = Object.keys(LINES[LOCALES[0]]).sort()
  assert.ok(reference.length >= 6)
  for (const locale of LOCALES) {
    assert.deepEqual(Object.keys(LINES[locale]).sort(), reference, `пулы локали ${locale}`)
    for (const [pool, lines] of Object.entries(LINES[locale])) {
      assert.ok(Array.isArray(lines) && lines.length > 0, `${locale}.${pool} пуст`)
      for (const line of lines) {
        assert.equal(typeof line, 'string')
        assert.ok(line.trim().length > 0, `${locale}.${pool}: пустая строка`)
      }
    }
  }
})

test('pickLine детерминирован, не повторяет предыдущую и переживает неизвестный пул', () => {
  assert.equal(pickLine('ru', 'idle', () => 0), LINES.ru.idle[0])
  assert.equal(pickLine('zh-CN', 'idle', () => 0), LINES['zh-CN'].idle[0])
  assert.equal(pickLine('ru', 'idle', () => 0.999), LINES.ru.idle[LINES.ru.idle.length - 1])
  const first = LINES.ru.idle[0]
  const next = pickLine('ru', 'idle', () => 0, first)
  assert.notEqual(next, first, 'предыдущая строка пропускается, пока есть альтернативы')
  assert.equal(pickLine('ru', 'no-such-pool', () => 0), null)
  // неизвестная локаль падает на локаль по умолчанию, а не ломается
  assert.equal(typeof pickLine('de', 'idle', () => 0), 'string')
  assert.equal(typeof pickLine(undefined, 'idle', () => 0), 'string')
})

test('linesFor отдаёт пул или пустой массив, локаль по умолчанию — en', () => {
  assert.equal(DEFAULT_LOCALE, 'en')
  assert.equal(linesFor(undefined, 'idle').length, LINES.en.idle.length)
  assert.equal(linesFor('ru', 'idle').length, LINES.ru.idle.length)
  assert.equal(linesFor('zh-CN', 'idle').length, LINES['zh-CN'].idle.length)
  assert.deepEqual(linesFor('zh-CN', 'waiting'), ['等你哦'])
  assert.deepEqual(linesFor('ru', 'нет-такого'), [])
  assert.deepEqual(linesFor('нет-такой-локали', 'нет-такого'), [])
})

test('teamStatusLine перечисляет только ненулевые состояния и локализуется', () => {
  const team = { active: 2, waiting: 1, completed: 0, errors: 0, coordinating: true }
  assert.equal(teamStatusLine('ru', team), 'Помощники: 2 работают · 1 ждут')
  assert.equal(teamStatusLine('en', team), 'Helpers: 2 working · 1 waiting')
  assert.equal(teamStatusLine('zh-CN', team), '小助手：有 2 个正在工作 · 有 1 个在等待')
  assert.equal(teamStatusLine('ru', { active: 0, waiting: 0, completed: 0, errors: 0 }), null)
  assert.equal(teamStatusLine('ru', { active: 0, waiting: 0, completed: 3, errors: 1 }), 'Помощники: 3 завершили · 1 с ошибкой')
})
