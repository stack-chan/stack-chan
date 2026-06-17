import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

const design = readFileSync(new URL('./mod-transfer-design.md', import.meta.url), 'utf8')

describe('MOD transfer design document', () => {
  it('defines the browser build and transfer architecture', () => {
    for (const required of [
      'Build service',
      'Web Serial',
      'BLE Serial',
      'Transfer protocol',
      'MVP acceptance gates',
      'Security boundaries',
    ]) {
      assert.match(design, new RegExp(required))
    }
  })
})
