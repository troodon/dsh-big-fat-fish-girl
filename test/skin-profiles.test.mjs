// Per-skin data: every installed skin carries head anchors that fit the manifest, and the
// gaze profile and bubble placement come from that data, not from code.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_MANIFEST } from '../lib/animation/manifest-defaults.mjs'
import { SKIN_PROFILES } from '../lib/animation/skin-profiles.mjs'
import { bubbleBottomPx } from '../lib/rendering/bubble-layout.mjs'
import { gazeProfileForSkin } from '../lib/animation/gaze.mjs'
import { DEFAULT_SKIN } from '../lib/settings/prefs.mjs'
import { listSkins } from '../lib/host/skins.mjs'

test('every installed skin has one head anchor per row of every sheet', () => {
  for (const skin of listSkins()) {
    const profile = SKIN_PROFILES[skin.id]
    assert.ok(profile, `${skin.id} has no generated profile; run node scripts/build-skin-data.mjs`)
    for (const [id, sheet] of Object.entries(DEFAULT_MANIFEST.sheets)) {
      assert.equal(profile.head[id].length, sheet.rows, `${skin.id} head.${id}`)
    }
  }
})

test('DeepSeek Chan is the only installed skin and mirrors its authored gaze strip', () => {
  const skins = listSkins()
  assert.deepEqual(skins.map((skin) => skin.id), ['deepseek-chan'])
  assert.equal(skins[0].title, 'DeepSeek Chan (Big Fat Fish Girl)')
  assert.equal(DEFAULT_SKIN, skins[0].id)
  assert.deepEqual(gazeProfileForSkin(DEFAULT_SKIN), { gazeRows: [9], mirrorLeft: true })
  assert.equal(gazeProfileForSkin('unknown-skin'), null)
})

test('an unknown skin places its bubble where the default skin does', () => {
  const frame = { sheet: 'base', row: 3 }
  assert.equal(bubbleBottomPx(132, 'unknown-skin', frame), bubbleBottomPx(132, DEFAULT_SKIN, frame))
})

test('bubble anchors keep their measured positions after moving into skin.json', () => {
  // Regression: the anchors now live in skin.json; the bubble must not move with the move.
  assert.equal(bubbleBottomPx(132, DEFAULT_SKIN, { sheet: 'base', row: 0 }), 180.375)
})
