import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

const vendorRoot = 'vendor/stackchan-voice'

test('stackchan-voice vendor snapshot matches its recorded provenance', () => {
  const provenance = JSON.parse(readFileSync(join(vendorRoot, 'VENDOR_SOURCE.json'), 'utf8')) as {
    dictionary: { file: string; sha256: string; license: string }
    files: Record<string, string>
  }

  for (const [file, expected] of Object.entries(provenance.files)) {
    const actual = createHash('sha256')
      .update(readFileSync(join(vendorRoot, file)))
      .digest('hex')
    assert.equal(actual, expected, `${file} must match VENDOR_SOURCE.json`)
  }

  assert.equal(provenance.files[provenance.dictionary.file], provenance.dictionary.sha256)
  assert.equal(provenance.dictionary.license, 'modified BSD')
})

test('default behavior exposes stackchan-voice synthesis from the drawer', () => {
  const source = readFileSync('host/app/default-behavior/on-context-created.ts', 'utf8')
  assert.match(source, /SPEECH_SYNTHESIS_TEXT = 'こんにちわ。すたっくちゃんです。'/)
  assert.match(source, /key: 'speakStackchan'/)
  assert.match(source, /target\.audio\.say\(SPEECH_SYNTHESIS_TEXT\)/)
})
