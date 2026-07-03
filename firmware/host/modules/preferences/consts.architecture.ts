import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { test } from 'node:test'

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

test('loadPreference is imported only by app composition and preferences module', () => {
  const offenders = SOURCE_ROOTS.flatMap(listSourceFiles)
    .map((path) => relative('.', path))
    .filter((path) => LOAD_PREFERENCE_IMPORT.test(readFileSync(path, 'utf8')))
    .filter((path) => !ALLOWED_LOAD_PREFERENCE_PREFIXES.some((prefix) => path.startsWith(prefix)))

  assert.deepEqual(offenders, [])
})

test('loadPreference resolves optional MOD config lazily', () => {
  const source = readFileSync('host/modules/preferences/loadPreference.ts', 'utf8')

  assert.match(source, /function loadModConfig\(\): ConfigRecord/)
  assert.match(source, /try \{/)
  assert.match(source, /Modules\.has\('mod\/config'\)/)
  assert.doesNotMatch(source, /const modConfig: ConfigRecord = Modules\.has/)
})

test('web preference console uses the canonical ui preference domain for face type', () => {
  const source = readFileSync('../web/preference/index.html', 'utf8')

  assert.match(source, /['"]ui\.type['"]/)
  assert.match(source, /name="ui\.type"/)
  assert.match(source, /id="ui\.type"/)
  assert.doesNotMatch(source, /renderer\.type/)
})
