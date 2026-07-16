import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

const vendorRoot = 'vendor/stackchan-voice'

test('stackchan-voice native resources are limited to CoreS3 and the WASM simulator', () => {
  const manifest = JSON.parse(readFileSync('host/modules/audio/manifest.json', 'utf8')) as {
    include: string[]
    modules: Record<string, string | string[]>
    platforms: Record<string, { include?: string[]; modules?: Record<string, string> }>
  }
  const wasmManifest = JSON.parse(readFileSync('host/modules/audio/manifest_wasm.json', 'utf8')) as {
    include: string[]
    modules: Record<string, string>
  }
  const lin = manifest.platforms.lin
  const coreS3 = manifest.platforms['esp32/m5stackchan_cores3']

  assert.equal(manifest.include.includes('../../../vendor/stackchan-voice/manifest.json'), false)
  assert.equal(manifest.include.includes('$(MODDABLE)/modules/io/audioout/manifest.json'), false)
  assert.ok(lin.include?.includes('$(MODDABLE)/modules/io/audioout/manifest.json'))
  assert.match(readFileSync('host/modules/audio/tts-stackchan-voice.ts', 'utf8'), /unavailable on this target/)
  assert.ok(coreS3.include?.includes('../../../vendor/stackchan-voice/manifest.json'))
  assert.ok(coreS3.include?.includes('$(MODDABLE)/modules/io/audioout/manifest.json'))
  assert.equal(coreS3.modules?.['tts-stackchan-voice'], './stackchan-voice/tts-stackchan-voice')
  assert.ok(wasmManifest.include.includes('../../../vendor/stackchan-voice/manifest.json'))
  assert.equal(wasmManifest.modules['tts-stackchan-voice'], './wasm/tts-stackchan-voice')
})

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

  const notice = readFileSync(join(vendorRoot, 'NOTICE'), 'utf8')
  assert.doesNotMatch(notice, /data\/frontend\/UNIDIC-/)
  assert.match(notice, /data\/UNIDIC-AUTHORS\.txt/)
  assert.match(notice, /data\/UNIDIC-BSD\.txt/)
})

test('default behavior exposes stackchan-voice synthesis from the drawer', () => {
  const source = readFileSync('host/app/default-behavior/on-context-created.ts', 'utf8')
  assert.match(source, /SPEECH_SYNTHESIS_TEXT = 'こんにちわ。すたっくちゃんです。'/)
  assert.match(source, /key: 'speakStackchan'/)
  assert.match(source, /target\.audio\.say\(SPEECH_SYNTHESIS_TEXT\)/)
  assert.match(source, /\[SpeechSynthesis\] error \$\{errorMessage\(error\)\}/)
})

test('the block editor speech command selects stackchan-voice on CoreS3 and WASM', () => {
  const blocks = readFileSync('../web/editor/blocks.mjs', 'utf8')
  const coreS3 = JSON.parse(readFileSync('host/platforms/m5stackchan_cores3/manifest.json', 'utf8'))
  const wasm = JSON.parse(readFileSync('host/platforms/wasm/manifest.json', 'utf8'))

  assert.match(blocks, /return `await robot\.audio\.say\(String\(\$\{text\}\)\)\\n`/)
  assert.equal(coreS3.config.tts.type, 'stackchan-voice')
  assert.equal(wasm.config.tts.type, 'stackchan-voice')
})
