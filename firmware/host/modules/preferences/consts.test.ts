import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { test } from 'node:test'

import { DEFAULT_FONT, DOMAIN, PREF_KEYS } from './consts.js'

const SOURCE_ROOTS = ['host', 'mods']
const SOURCE_EXTENSIONS = new Set(['.js', '.ts'])
const LOAD_PREFERENCE_IMPORT = /from\s+['"]loadPreference['"]|import\(\s*['"]loadPreference['"]\s*\)/
const ALLOWED_LOAD_PREFERENCE_PREFIXES = ['host/app/', 'host/modules/preferences/']

function listSourceFiles(root: string): string[] {
  const entries = readdirSync(root)
  return entries.flatMap((entry) => {
    const path = join(root, entry)
    const stat = statSync(path)
    if (stat.isDirectory()) return listSourceFiles(path)
    return SOURCE_EXTENSIONS.has(path.slice(path.lastIndexOf('.'))) ? [path] : []
  })
}

test('preference domains and keys describe the app configuration surface', () => {
  assert.equal(DOMAIN.ui, 'ui')
  assert.equal(DOMAIN.driver, 'driver')
  assert.ok(PREF_KEYS.some(([domain, key, ctor]) => domain === DOMAIN.ui && key === 'type' && ctor === String))
  assert.ok(PREF_KEYS.some(([domain, key, ctor]) => domain === DOMAIN.driver && key === 'baudrate' && ctor === Number))
  assert.equal(DEFAULT_FONT, 'OpenSans-Regular-24.bf4')
})

test('loadPreference is imported only by app composition and preferences module', () => {
  const offenders = SOURCE_ROOTS.flatMap(listSourceFiles)
    .map((path) => relative('.', path))
    .filter((path) => LOAD_PREFERENCE_IMPORT.test(readFileSync(path, 'utf8')))
    .filter((path) => !ALLOWED_LOAD_PREFERENCE_PREFIXES.some((prefix) => path.startsWith(prefix)))

  assert.deepEqual(offenders, [])
})
