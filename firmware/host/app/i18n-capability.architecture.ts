import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { SUPPORTED_LOCALES } from '../modules/ui/localization-core.js'

const localizedDrawerRoot = join('mods', 'examples', 'localized_drawer')

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
}

test('StackchanContext exposes the host-owned i18n capability', () => {
  const capabilities = readFileSync(join('host', 'app', 'capabilities.ts'), 'utf8')
  const runtimeContext = readFileSync(join('host', 'app', 'runtime-context.ts'), 'utf8')
  const localization = readFileSync(join('host', 'modules', 'ui', 'localization.ts'), 'utf8')

  assert.match(capabilities, /i18n:\s*I18nCapability/)
  assert.match(runtimeContext, /#i18nCapability\s*:\s*I18nCapability/)
  assert.match(runtimeContext, /this\.#i18nCapability\s*=\s*createI18nCapability\(\)/)
  assert.match(runtimeContext, /get i18n\(\):\s*I18nCapability/)
  assert.match(localization, /new Locals\('modLocals'\)/)
  assert.match(localization, /resolveLocalizedMessage\(key, values, getModLocals\(\), getHostLocals\(\)\)/)
})

test('localized Drawer sample uses context.i18n and ships every supported catalog', () => {
  const manifest = readJson(join(localizedDrawerRoot, 'manifest.json')) as {
    resources?: Record<string, string[]>
  }
  const source = readFileSync(join(localizedDrawerRoot, 'mod.js'), 'utf8')

  assert.deepEqual(manifest.resources?.['*'], ['./strings/*'])
  assert.match(source, /context\.i18n/)
  assert.match(source, /context\.ui\.drawer\.addDrawerButton/)
  assert.doesNotMatch(source, /new Locals|from ['"]localization['"]/)

  const catalogs = SUPPORTED_LOCALES.map((locale) => readJson(join(localizedDrawerRoot, 'strings', `${locale}.json`)))
  const expectedKeys = Object.keys(catalogs[0]).sort()
  assert.ok(expectedKeys.length > 0)
  for (const [index, catalog] of catalogs.entries()) {
    assert.deepEqual(Object.keys(catalog).sort(), expectedKeys, `${SUPPORTED_LOCALES[index]} keys`)
  }
})
