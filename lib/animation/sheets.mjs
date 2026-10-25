// Where a skin's sheets live on the host. The URL carries the sheet's content revision, so a
// cache keeps each skin's atlas apart and a changed atlas is never served from an old cache.
// Pure: the host and both pages build the same URLs from the same manifest.
import { API_PREFIX } from '../protocol/contract.mjs'
import { SHEET_ASSET_REVISIONS } from './sheet-revisions.mjs'

export function skinSheetUrl(skin, sheet) {
  const revision = SHEET_ASSET_REVISIONS[skin]?.[sheet.file] ?? 'unversioned'
  return `${API_PREFIX}/skin/${encodeURIComponent(skin)}/${encodeURIComponent(sheet.file)}?v=${revision}`
}
