import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { writeAliasPackage, writeAliasPackageSubpath } from '../../testing/node-alias-package.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
writeAliasPackageSubpath(root, 'stackchan', 'errors', resolve(root, '../../sdk/errors.js'))
for (const name of ['audio-playback', 'audio-recording'])
  writeAliasPackageSubpath(root, 'stackchan-contracts', name, resolve(root, `../../contracts/${name}.js`))
writeAliasPackage(root, 'pcm-wave', resolve(root, 'audio/pcm-wave.js'))
const { recordedAudio, validateAudioData } = await import('../recorded-audio.js')
const { createRecordingWave } = await import('../recording-wave.js')

test('recording exposes owned bytes and the actual native or browser format', () => {
  const { buffer } = createRecordingWave({ sampleRate: 16000, channels: 1, bitsPerSample: 16 }, 10)
  const native = recordedAudio(buffer, false)
  assert.equal(native.data, buffer, 'no extra full-size copy is needed at the public boundary')
  assert.equal(native.mimeType, 'audio/wav')
  assert.equal(native.filename, 'recording.wav')
  assert.ok(Object.isFrozen(native))
  for (const mimeType of ['audio/webm;codecs=opus', 'audio/mp4;codecs=mp4a.40.2']) {
    const data = Object.assign(Uint8Array.of(1, 2, 3).buffer, { mimeType, filename: 'recording.m4a' })
    const browser = recordedAudio(data, true)
    assert.equal(browser.data, data)
    assert.equal(browser.mimeType, mimeType, 'codec parameters survive without relabelling as WAV')
    assert.equal(browser.filename, data.filename)
    validateAudioData(browser)
  }
})

test('invalid provider output is IO and invalid application input is INVALID_ARGUMENT', () => {
  const { buffer } = createRecordingWave({ sampleRate: 16000, channels: 1, bitsPerSample: 16 }, 10)
  assert.throws(() => recordedAudio(buffer, true), { code: 'IO' })
  assert.throws(() => recordedAudio(new ArrayBuffer(44), false), { code: 'IO' })
  assert.throws(() => recordedAudio(new ArrayBuffer(512 * 1024 + 1), false), { code: 'IO' })
  for (const mimeType of ['', 'video/webm', 'audio/wav\r\nInjected: header']) {
    assert.throws(() => validateAudioData({ data: buffer, mimeType }), { code: 'INVALID_ARGUMENT' })
    assert.throws(() => recordedAudio(Object.assign(buffer, { mimeType, filename: 'recording.wav' }), true), {
      code: 'IO',
    })
  }
  for (const data of [new ArrayBuffer(0), new ArrayBuffer(3 * 1024 * 1024 + 1)])
    assert.throws(() => validateAudioData({ data, mimeType: 'audio/wav' }), { code: 'INVALID_ARGUMENT' })
})
