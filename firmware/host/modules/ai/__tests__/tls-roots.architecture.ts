import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

function sources(section: Record<string, string | string[]> | undefined) {
  return Object.values(section ?? {}).flat()
}

test('AI trust anchors use explicit SDK certificates rather than the whole trust store', () => {
  const manifest = JSON.parse(readFileSync('host/modules/ai/manifest.json', 'utf8'))
  const certificates = [...sources(manifest.data), ...sources(manifest.resources)].filter((source) =>
    source.includes('/crypt/data/ca'),
  )
  assert.ok(certificates.length > 0, 'AI HTTPS needs explicitly selected trust anchors')
  for (const source of certificates) {
    assert.match(source, /^\$\((?:MODDABLE|MODULES)\)\/(?:modules\/)?crypt\/data\/ca\d+(?:\.der)?$/)
  }
  assert.equal(new Set(certificates).size, certificates.length, 'Do not repeat trust anchors')
})
