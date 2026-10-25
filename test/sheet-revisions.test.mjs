import test from 'node:test'
import assert from 'node:assert/strict'
import { skinSheetUrl } from '../lib/animation/sheets.mjs'
import { SHEET_ASSET_REVISIONS } from '../lib/animation/sheet-revisions.mjs'

test('immutable atlas URLs change when the PNG content changes', () => {
  for (const [skin, sheets] of Object.entries(SHEET_ASSET_REVISIONS)) {
    for (const [file, revision] of Object.entries(sheets)) {
      assert.match(revision, /^[\da-f]{64}$/, `${skin}/${file} has a SHA-256 revision`)
      const url = new URL(skinSheetUrl(skin, { file }), 'http://localhost')
      assert.equal(url.searchParams.get('v'), revision, `${skin}/${file} URL carries its content hash`)
    }
  }
})
