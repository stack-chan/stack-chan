import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { prepareM5StackChanCoreS3IdfDependencies } from './idf-dependencies.mjs'

test('prepares both managed components without duplicating them', () => {
  const moddableDirectory = mkdtempSync(path.join(tmpdir(), 'stackchan-idf-dependencies-'))

  try {
    const manifestPath = prepareM5StackChanCoreS3IdfDependencies({ moddableDirectory, mode: 'debug' })
    const first = readFileSync(manifestPath, 'utf8')
    prepareM5StackChanCoreS3IdfDependencies({ moddableDirectory, mode: 'debug' })
    const second = readFileSync(manifestPath, 'utf8')

    assert.equal(second, first)
    assert.equal(count(second, 'espressif/esp_audio_codec:'), 1)
    assert.equal(count(second, 'espressif/esp32-camera:'), 1)
  } finally {
    rmSync(moddableDirectory, { recursive: true, force: true })
  }
})

function count(source, value) {
  return source.split(value).length - 1
}
