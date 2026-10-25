#!/usr/bin/env node
// Asset gate: the manifest and every installed skin must agree.
//
// Run it in CI and before a release. A contributor who adds a sheet, an animation or a
// whole skin gets a readable report instead of a silently missing or misaligned pet.
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_MANIFEST, validateManifest } from '../lib/animation/manifest.mjs'
import { DEFAULT_SKIN, listSkins } from '../lib/host/skins.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const problems = []

const { problems: schemaProblems } = validateManifest(DEFAULT_MANIFEST)
problems.push(...schemaProblems)

const skins = listSkins()
if (skins.length === 0) problems.push(`no skins found under lib/skins (expected "${DEFAULT_SKIN}")`)

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
let checked = 0
let skipped = 0

for (const skin of skins) {
  for (const [id, sheet] of Object.entries(DEFAULT_MANIFEST.sheets)) {
    if (sheet.cellWidth !== 256 || sheet.cellHeight !== 256) {
      problems.push(`sheet "${id}": runtime cells must be 256x256, got ${sheet.cellWidth}x${sheet.cellHeight}`)
    }
    const file = join(skin.dir, sheet.file)
    if (!existsSync(file)) {
      if (sheet.optional === true) {
        skipped += 1
        console.log(`skip   skin "${skin.id}" sheet "${id}" — ${sheet.file} (optional, art not drawn yet)`)
        continue
      }
      problems.push(`skin "${skin.id}" sheet "${id}": ${sheet.file} is missing`)
      continue
    }
    const bytes = readFileSync(file)
    if (!bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
      problems.push(`skin "${skin.id}" sheet "${id}": ${sheet.file} is not a PNG`)
      continue
    }
    const width = bytes.readUInt32BE(16)
    const height = bytes.readUInt32BE(20)
    const expectedWidth = sheet.columns * sheet.cellWidth
    const expectedHeight = sheet.rows * sheet.cellHeight
    if (width !== expectedWidth || height !== expectedHeight) {
      problems.push(`skin "${skin.id}" sheet "${id}": ${width}x${height} but the manifest declares ${expectedWidth}x${expectedHeight}`)
      continue
    }
    checked += 1
    console.log(`ok     skin "${skin.id}" sheet "${id}" — ${sheet.file} ${width}x${height} (${sheet.columns}x${sheet.rows} cells)`)
  }
}

if (problems.length > 0) {
  console.error('\nverify-assets: FAILED')
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exit(1)
}

console.log(`\nverify-assets: OK — ${skins.length} skin(s), ${checked} sheet(s) checked, ${skipped} optional skipped, ${DEFAULT_MANIFEST.animations.length} animations declared`)
