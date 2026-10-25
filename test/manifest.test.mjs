// Manifest: validation, indexing, frame math, and geometry against the real PNG.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { listSkins } from '../lib/host/skins.mjs'
import {
  DEFAULT_MANIFEST, cellFor, frameIndex, gazeCell, indexManifest, validateManifest,
} from '../lib/animation/manifest.mjs'
import { gazeIndexFromPoint } from '../lib/animation/gaze.mjs'
import { canvasPixelAt, canvasSideForSize, centeredCanvasOffset } from '../lib/rendering/pet-geometry.mjs'
import { createCanvasRenderer } from '../lib/web/surface.mjs'

const clone = () => JSON.parse(JSON.stringify(DEFAULT_MANIFEST))

test('штатный манифест проходит валидацию', () => {
  const result = validateManifest(DEFAULT_MANIFEST)
  assert.deepEqual(result.problems, [])
  assert.equal(result.ok, true)
})

test('валидация ловит типовые поломки', () => {
  const cases = [
    ['неизвестный лист', (m) => { m.animations[0].sheet = 'nope' }],
    ['дубликат id', (m) => { m.animations.push({ ...m.animations[0] }) }],
    ['ряд за границей листа', (m) => { m.animations[0].row = 99 }],
    ['кадров больше, чем колонок', (m) => { m.animations[0].frames = 99 }],
    ['fps = 0', (m) => { m.animations[0].fps = 0 }],
    ['явный кадр вне листа', (m) => { m.animations.push({ id: 'bad', sheet: 'base', frames: [999], fps: 1 }) }],
    ['состояние ссылается на несуществующую анимацию', (m) => { m.states.idle.anim = 'ghost' }],
    ['gaze без gazeRows', (m) => { delete m.animations.find((a) => a.id === 'gaze').gazeRows }],
    ['акт ссылается на несуществующую анимацию', (m) => { m.acts.idle.push({ anim: 'ghost', weight: 1, ms: 100 }) }],
    ['вес акта <= 0', (m) => { m.acts.hover[0].weight = 0 }],
    ['битый лист', (m) => { m.sheets.base.columns = 0 }],
    ['не та версия', (m) => { m.version = 2 }],
    ['длительностей меньше кадров', (m) => { m.animations.find((a) => a.id === 'waitingCall').frameDurationsMs = [100] }],
    ['отрицательная длительность кадра', (m) => { m.animations.find((a) => a.id === 'editFile').frameDurationsMs[2] = -5 }],
    ['состояние ссылается на несуществующий fallback', (m) => { m.states.waiting.fallback = 'ghost' }],
    ['сцена ссылается на несуществующий вариант', (m) => { m.scenes.meal.variants[0].anim = 'ghost' }],
    ['вес варианта сцены должен быть положительным', (m) => { m.scenes.meal.variants[0].weight = 0 }],
  ]
  for (const [name, mutate] of cases) {
    const manifest = clone()
    mutate(manifest)
    const result = validateManifest(manifest)
    assert.equal(result.ok, false, `должно падать: ${name}`)
    assert.ok(result.problems.length > 0, `нужна причина: ${name}`)
  }
})

test('необъектный манифест не роняет валидатор', () => {
  for (const value of [null, 42, 'manifest', []]) {
    const result = validateManifest(value)
    assert.equal(result.ok, false)
  }
})

test('индексация: ряд, явные кадры, необязательные анимации', () => {
  const index = indexManifest(DEFAULT_MANIFEST)
  assert.deepEqual(index.animations.get('idle').indices, [0, 1, 2, 3, 4, 5])
  assert.deepEqual(index.animations.get('runLeft').indices, [16, 17, 18, 19, 20, 21, 22, 23])
  assert.deepEqual(index.animations.get('lookAround').indices.slice(0, 3), [72, 74, 76])
  assert.equal(index.animations.get('eatRice').optional, false, 'арт еды уже нарисован')
  assert.equal(index.animations.get('eatRice').indices.length, 6)
  assert.deepEqual(index.scenes.meal.variants.map(({ anim, weight }) => [anim, weight]), [
    ['snack', 8], ['eatRice', 3], ['sushiTray', 1],
  ])
  assert.equal(index.scenes.meal.variants.some(({ anim }) => anim === 'tokenWallet'), false,
    'кошелёк не входит в варианты еды')
})

test('кадры: loop заворачивается, once зажимается, reduced motion стоит на первом', () => {
  const idle = { indices: [0, 1, 2, 3, 4, 5], fps: 3, loop: true }
  assert.equal(frameIndex(idle, 0), 0)
  assert.equal(frameIndex(idle, 1000), 3)
  assert.equal(frameIndex(idle, 2000), 0)
  const jump = { indices: [32, 33, 34, 35, 36], fps: 9, loop: false }
  assert.equal(frameIndex(jump, 0), 0)
  assert.equal(frameIndex(jump, 9000), 4)
  assert.equal(frameIndex(idle, 1000, true), 0)
  assert.equal(frameIndex({ indices: [7], fps: 5, loop: true }, 9000), 0)
})

test('cellFor и gazeCell раскладывают сетку', () => {
  const index = indexManifest(DEFAULT_MANIFEST)
  const sheet = index.sheets.base
  assert.deepEqual(cellFor(5, index.animations.get('idle'), sheet), { row: 0, column: 5 })
  const gaze = index.animations.get('gaze')
  assert.deepEqual(gazeCell(0, gaze, sheet), { row: 9, column: 0, flipX: false })
  assert.deepEqual(gazeCell(7, gaze, sheet), { row: 9, column: 7, flipX: false })
  assert.deepEqual(gazeCell(8, gaze, sheet), { row: 10, column: 0, flipX: false })
  assert.deepEqual(gazeCell(15, gaze, sheet), { row: 10, column: 7, flipX: false })
  assert.deepEqual(gazeCell(16, gaze, sheet), { row: 9, column: 0, flipX: false })
  assert.deepEqual(gazeCell(-1, gaze, sheet), { row: 10, column: 7, flipX: false })
})

test('gaze math supports a short mirrored strip without coupling it to a skin', () => {
  const index = indexManifest(DEFAULT_MANIFEST)
  const sheet = index.sheets.base
  const gaze = index.animations.get('gaze')
  const profile = { gazeRows: [9], mirrorLeft: true }
  const shortGaze = { ...gaze, gazeRows: profile.gazeRows }
  for (let degrees = 0; degrees < 360; degrees += 1) {
    const radians = degrees * Math.PI / 180
    const direction = gazeIndexFromPoint(Math.sin(radians), -Math.cos(radians), profile)
    const cell = gazeCell(direction, shortGaze, sheet, { mirror: profile.mirrorLeft })
    assert.equal(cell.row, 9, `pointer at ${degrees}° should not turn the body`)
  }
  assert.deepEqual(gazeCell(gazeIndexFromPoint(1, -1, profile), shortGaze, sheet, { mirror: true }), { row: 9, column: 2, flipX: false })
  assert.deepEqual(gazeCell(gazeIndexFromPoint(-1, -1, profile), shortGaze, sheet, { mirror: true }), { row: 9, column: 2, flipX: true })
})

test('hover не запускает анимацию поворота корпуса', () => {
  assert.ok(DEFAULT_MANIFEST.acts.hover.every(({ anim }) => anim !== 'lookAround'))
  assert.ok(DEFAULT_MANIFEST.acts.idle.some(({ anim }) => anim === 'lookAround'))
})

test('рендерер зеркалит кадр gaze без поворота на соседний ряд атласа', () => {
  const index = indexManifest(DEFAULT_MANIFEST)
  const calls = []
  const context = {
    clearRect: () => calls.push('clear'),
    save: () => calls.push('save'),
    translate: (...args) => calls.push(['translate', ...args]),
    scale: (...args) => calls.push(['scale', ...args]),
    drawImage: (...args) => calls.push(['draw', ...args.slice(1)]),
    restore: () => calls.push('restore'),
  }
  const canvas = { width: 0, height: 0 }
  const draw = createCanvasRenderer({
    engine: { resolve: () => ({ sheet: 'base', row: 9, column: 2, flipX: true }) },
    index, canvas, context, dpr: 1, ensureSheet: () => ({}),
  })

  draw(0)
  assert.deepEqual(calls.slice(0, 5).map((call) => Array.isArray(call) ? call[0] : call), ['clear', 'save', 'translate', 'scale', 'draw'])
  assert.deepEqual(calls.at(-1), 'restore')
  assert.deepEqual(calls[2], ['translate', 256, 0])
  assert.deepEqual(calls[3], ['scale', -1, 1])
})

test('базовый лист обслуживается старым маршрутом /atlas.png', () => {
  // The raw manifest carries no URLs: the host adds the active skin's paths.
  assert.equal(DEFAULT_MANIFEST.sheets.base.url, undefined)
  assert.equal(DEFAULT_MANIFEST.sheets.food.url, undefined)
})

test('геометрия манифеста совпадает с реальным PNG', () => {
  const sheet = DEFAULT_MANIFEST.sheets.base
  assert.deepEqual([sheet.cellWidth, sheet.cellHeight], [256, 256], 'runtime-клетка квадратная')
  for (const [id, declared] of Object.entries(DEFAULT_MANIFEST.sheets)) {
    assert.equal(declared.cellWidth, sheet.cellWidth, `лист ${id}: ширина клетки`)
    assert.equal(declared.cellHeight, sheet.cellHeight, `лист ${id}: высота клетки`)
  }
  for (const skin of listSkins()) {
    for (const [id, declared] of Object.entries(DEFAULT_MANIFEST.sheets)) {
      const bytes = readFileSync(new URL(`../lib/skins/${skin.id}/${declared.file}`, import.meta.url))
      assert.equal(bytes.readUInt32BE(16), declared.columns * 256, `${skin.id}/${id}: ширина PNG`)
      assert.equal(bytes.readUInt32BE(20), declared.rows * 256, `${skin.id}/${id}: высота PNG`)
    }
  }
})

test('квадратный экранный холст сохраняет размер, центр и прозрачные hit-поля', () => {
  for (const size of [88, 132, 172]) {
    const side = canvasSideForSize(size)
    const left = centeredCanvasOffset(size)
    assert.equal(side, size * 256 / 192)
    assert.equal(left + side / 2, size / 2, 'ось тела остаётся в прежней экранной координате')
    assert.deepEqual(canvasPixelAt({ x: left, y: 0, width: side, height: side }, left + side / 2, side * 250 / 256), { x: 128, y: 250 })
    assert.equal(canvasPixelAt({ x: left, y: 0, width: side, height: side }, left - 1, side / 2), null)
  }
})

test('индекс отдаёт все группы выходок и таблицу фаз (регресс: группы терялись)', () => {
  const index = indexManifest(DEFAULT_MANIFEST)
  // Регресс: раньше индекс копировал только hover и idle, и новые группы молча
  // не играли никогда — движок получал пустой список.
  assert.deepEqual(Object.keys(index.acts).sort(), Object.keys(DEFAULT_MANIFEST.acts).sort())
  for (const [group, acts] of Object.entries(index.acts)) {
    assert.ok(acts.length > 0, `группа ${group} не должна быть пустой`)
    for (const act of acts) {
      assert.ok(index.animations.has(act.anim), `${group}: ${act.anim} есть в индексе`)
      assert.ok(act.ms > 0, `${group}: ${act.anim} без длительности`)
    }
  }
  assert.deepEqual(Object.keys(index.toolActs).sort(), Object.keys(DEFAULT_MANIFEST.toolActs).sort())
  for (const [phase, anim] of Object.entries(index.toolActs)) {
    assert.ok(index.animations.has(anim), `фаза ${phase} ссылается на существующую анимацию`)
  }
})

test('reduced motion показывает смысловой staticFrame, а не первый кадр', () => {
  const animation = { indices: [0, 1, 2, 3, 4, 5], fps: 3, loop: true, staticFrame: 3 }
  assert.equal(frameIndex(animation, 0, true), 3)
  assert.equal(frameIndex(animation, 0, false), 0)
  assert.equal(frameIndex({ indices: [0, 1], fps: 3, loop: true, staticFrame: 99 }, 0, true), 1, 'якорь зажимается')
})

test('валидация ловит битые сцены и якоря', () => {
  const cases = [
    ['сцена ссылается на несуществующую анимацию', (m) => { m.scenes.compose.loop = 'ghost' }],
    ['fallback сцены ссылается на ghost', (m) => { m.scenes.waiting.fallback = 'ghost' }],
    ['staticFrame вне диапазона', (m) => { m.animations[0].staticFrame = 99 }],
    ['сцена без содержимого', (m) => { m.scenes.empty = {} }],
  ]
  for (const [name, mutate] of cases) {
    const manifest = clone()
    mutate(manifest)
    const result = validateManifest(manifest)
    assert.equal(result.ok, false, `должно падать: ${name}`)
  }
})

test('индекс отдаёт поставку animation-v2 и запасные пути', () => {
  const index = indexManifest(DEFAULT_MANIFEST)
  assert.equal(index.scenes.compose.loop, 'replyLoop', 'ответ циклически печатается после одноразового входа')
  assert.equal(index.scenes.compose.enter, 'replyEnter')
  assert.equal(index.scenes.edit.loop, 'editLoop')
  assert.equal(index.scenes.edit.enter, 'editEnter')
  assert.equal(index.scenes.edit.exit, 'editExit')
  assert.equal(index.scenes.edit.fallback, 'useTool', 'старый арт остаётся запасным')
  assert.equal(index.scenes.wallet.hold, 'walletCheck')
  assert.equal(index.animations.get('editFile').optional, false, 'арт поставлен')
  assert.equal(index.animations.get('walletCheck').indices.length, 9, 'кошелёк — девять кадров')
  assert.equal(DEFAULT_MANIFEST.states.waiting.anim, 'waitingCall', 'ожидание — полоса поставки')
  assert.equal(DEFAULT_MANIFEST.states.waiting.fallback, 'waiting', 'и старый арт как запас')
})

test('авторские длительности кадров побеждают fps', () => {
  const index = indexManifest(DEFAULT_MANIFEST)
  const waiting = index.animations.get('waitingCall')
  assert.deepEqual(waiting.frameDurationsMs, [180, 180, 180, 180, 260, 4000])
  // Одноразовая полоса: жест, потом удержание последнего кадра сколько угодно.
  assert.equal(frameIndex(waiting, 0), 0)
  assert.equal(frameIndex(waiting, 181), 1)
  assert.equal(frameIndex(waiting, 900), 4, 'последний кадр жеста')
  assert.equal(frameIndex(waiting, 1000), 5, 'жест закончился — удержание')
  assert.equal(frameIndex(waiting, 3500), 5)
  assert.equal(frameIndex(waiting, 99999), 5, 'без цикла остаётся удержание')
  assert.equal(frameIndex(waiting, 99999, true), 5, 'reduced motion показывает удержание')

  const typing = index.animations.get('replyTyping')
  assert.equal(frameIndex(typing, 3700), 0, 'цикл клавиатуры заворачивается')
})
