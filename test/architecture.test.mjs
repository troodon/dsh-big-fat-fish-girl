// Domain modules stay pure and shared by the host, browser page and desktop shell. The host
// and browser surface remain independent, while both can depend on domain code.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const LIB = fileURLToPath(new URL('../lib/', import.meta.url))
const DOMAIN_LAYERS = ['animation', 'behavior', 'i18n', 'rendering', 'settings', 'protocol']

/** Comments may name anything; only code counts. */
function codeOf(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
}

/** Identifiers only: phrases in string literals may use any word, a call to `fetch` may not. */
function identifiersOf(code) {
  return code.replace(/'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`/g, "''")
}

function modulesIn(layer) {
  return readdirSync(join(LIB, layer))
    .filter((name) => name.endsWith('.mjs'))
    .map((name) => {
      const code = codeOf(readFileSync(join(LIB, layer, name), 'utf8'))
      return { name: `${layer}/${name}`, code, identifiers: identifiersOf(code) }
    })
}

function importsOf(code) {
  return [...code.matchAll(/(?:from|import\()\s*['"]([^'"]+)['"]/g)].map((match) => match[1])
}

const BROWSER_OR_NODE = /\b(document|window|localStorage|navigator|fetch|EventSource|XMLHttpRequest|Image|setTimeout|setInterval|clearTimeout|clearInterval|requestAnimationFrame|process|Buffer|require)\b|node:/

test('domain modules are pure: no DOM, timers, network or Node APIs', () => {
  for (const layer of DOMAIN_LAYERS) {
    for (const file of modulesIn(layer)) {
      const found = file.identifiers.match(BROWSER_OR_NODE)
      assert.equal(found, null, `${file.name} uses ${found?.[0]}`)
    }
  }
})

test('domain modules do not depend on host or browser surfaces', () => {
  for (const layer of DOMAIN_LAYERS) {
    for (const file of modulesIn(layer)) {
      for (const spec of importsOf(file.code)) {
        assert.ok(spec.startsWith('.'), `${file.name} imports non-local dependency ${spec}`)
        const target = relative(LIB, resolve(LIB, dirname(file.name), spec))
        assert.ok(!target.startsWith('host/') && !target.startsWith('web/'), `${file.name} imports surface module ${spec}`)
      }
    }
  }
})

test('host never imports the browser half, and web never imports the host', () => {
  for (const file of modulesIn('host')) {
    for (const spec of importsOf(file.code)) assert.ok(!spec.includes('/web/'), `${file.name} imports ${spec}`)
  }
  for (const file of modulesIn('web')) {
    for (const spec of importsOf(file.code)) assert.ok(!spec.includes('/host/'), `${file.name} imports ${spec}`)
  }
})
