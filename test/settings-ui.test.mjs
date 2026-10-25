// Settings section logic, tested without React or a host: a tiny fake React and a fake
// shared config form are enough to prove the sliders and their writes.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createSettingsView, registerSettings } from '../lib/web/settings-ui.mjs'
import { DEFAULT_PREFS } from '../lib/settings/prefs.mjs'

function fakeReact() {
  return {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useCallback: (fn) => fn,
    useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useRef: (initial) => ({ current: initial }),
    useEffect: () => {},
  }
}

function fakeForm(value, overrides = {}) {
  const writes = []
  return {
    writes,
    subscribe() { return () => {} },
    getSnapshot() {
      return { status: 'ready', writable: true, revision: 7, value: { ...DEFAULT_PREFS, ...value }, ...overrides }
    },
    set(field, next) { writes.push([field, next]) },
  }
}

function findByType(node, type) {
  if (node === null || typeof node !== 'object') return null
  if (node.type === type) return node
  for (const child of node.children ?? []) {
    const found = findByType(child, type)
    if (found !== null) return found
  }
  return null
}

function allControls(node, controls = []) {
  if (node === null || typeof node !== 'object') return controls
  if (typeof node.type === 'string' && ['input', 'select', 'option'].includes(node.type)) controls.push(node)
  for (const child of node.children ?? []) allControls(child, controls)
  return controls
}

test('секция настроек рендерит оба ползунка в границах схемы', () => {
  const form = fakeForm({ size: 140, opacity: 0.8 })
  const View = createSettingsView(fakeReact(), form)
  const tree = View()
  const ranges = allControls(tree).filter((control) => control.props.type === 'range')
  assert.equal(ranges.length, 2, 'размер и прозрачность — ползунки')
  const size = ranges.find((control) => control.props.min === '88')
  assert.deepEqual([size.props.min, size.props.max, size.props.step, size.props.value], ['88', '172', '2', 140])
  const opacity = ranges.find((control) => control.props.min === '0.35')
  assert.deepEqual([opacity.props.max, opacity.props.step, opacity.props.value], ['1', '0.05', 0.8])
})

test('движение ползунка пишет значение в общий конфиг сразу', () => {
  const form = fakeForm({})
  const View = createSettingsView(fakeReact(), form)
  const tree = View()
  const size = allControls(tree).find((control) => control.props.type === 'range')
  size.props.onChange({ target: { value: '160' } })
  assert.deepEqual(form.writes, [['size', 160]], 'число, а не строка')
})

test('быстрые движения слайдера схлопываются: без очереди записей', async () => {
  const form = fakeForm({})
  const View = createSettingsView(fakeReact(), form)
  const tree = View()
  const size = allControls(tree).find((control) => control.props.type === 'range')
  size.props.onChange({ target: { value: '150' } })   // ведущая запись — сразу
  size.props.onChange({ target: { value: '160' } })   // в очередь
  size.props.onChange({ target: { value: '170' } })   // заменяет промежуточную
  assert.deepEqual(form.writes, [['size', 150]], 'промежуточные не уходят по одной')
  await new Promise((resolve) => setTimeout(resolve, 250))
  assert.deepEqual(form.writes, [['size', 150], ['size', 170]], 'догоняет только последняя')
})

test('отпускание слайдера сбрасывает хвост немедленно', async () => {
  const form = fakeForm({})
  const View = createSettingsView(fakeReact(), form)
  const tree = View()
  const size = allControls(tree).find((control) => control.props.type === 'range')
  size.props.onChange({ target: { value: '150' } })
  size.props.onChange({ target: { value: '166' } })
  size.props.onPointerUp()
  assert.deepEqual(form.writes, [['size', 150], ['size', 166]], 'финал ушёл без ожидания таймера')
})

test('галочки и язык пишут те же поля схемы, включая упрощённый китайский', () => {
  const form = fakeForm({})
  const View = createSettingsView(fakeReact(), form)
  const tree = View()
  const checkboxes = allControls(tree).filter((control) => control.props.type === 'checkbox')
  assert.equal(checkboxes.length, 7, 'шесть поведенческих тумблеров и автозапуск оболочки')
  checkboxes[0].props.onChange({ target: { checked: false } })
  checkboxes[6].props.onChange({ target: { checked: false } })
  const controls = allControls(tree)
  const select = controls.find((control) => control.type === 'select' && ['ru', 'en', 'zh-CN'].includes(control.props.value))
  const locales = select.children.filter((option) => option?.type === 'option')
  assert.deepEqual(locales.map((option) => option.props.value), ['ru', 'en', 'zh-CN'])
  assert.equal(locales[2].children[0], '简体中文')
  select.props.onChange({ target: { value: 'zh-CN' } })
  assert.deepEqual(form.writes, [['reducedMotion', false], ['autoStartShell', false], ['locale', 'zh-CN']])
})

test('недоступные настройки отключают контролы и не врут про готовность', () => {
  const form = fakeForm({}, { status: 'unavailable', writable: false })
  const View = createSettingsView(fakeReact(), form)
  const tree = View()
  for (const control of allControls(tree)) {
    if (control.type === 'option') continue
    assert.equal(control.props.disabled, true, `${control.type} должен быть disabled`)
  }
})

test('без сервисов хоста регистрация тихо пропускается', () => {
  // В тестовом окружении require('react') недоступен/пуст — регистрация не падает.
  assert.equal(registerSettings(undefined), null)
  assert.equal(registerSettings({ get: () => undefined }), null)
})
