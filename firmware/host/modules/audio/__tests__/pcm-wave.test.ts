import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { writeAliasPackageSubpath } from '../../testing/node-alias-package.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
writeAliasPackageSubpath(root, 'stackchan', 'errors', resolve(root, '../../sdk/errors.js'))
writeAliasPackageSubpath(
  root,
  'stackchan-contracts',
  'audio-playback',
  resolve(root, '../../contracts/audio-playback.js'),
)
const { parsePcmWave } = await import('../pcm-wave.js')

function wave({ channels = 1, frames = 3, sampleRate = 16000, metadata = false } = {}) {
  const format = new Uint8Array(16)
  const view = new DataView(format.buffer)
  view.setUint16(0, 1, true)
  view.setUint16(2, channels, true)
  view.setUint32(4, sampleRate, true)
  view.setUint32(8, sampleRate * channels * 2, true)
  view.setUint16(12, channels * 2, true)
  view.setUint16(14, 16, true)
  const pcm = new Uint8Array(frames * channels * 2).fill(42)
  const chunks: Array<[string, Uint8Array]> = [
    ['fmt ', format],
    ['data', pcm],
  ]
  if (metadata) {
    chunks.unshift(['JUNK', new Uint8Array(3)])
    chunks.push(['LIST', new Uint8Array(5)])
  }
  const buffer = new ArrayBuffer(12 + chunks.reduce((n, [, bytes]) => n + 8 + bytes.length + (bytes.length & 1), 0))
  const output = new DataView(buffer)
  const bytes = new Uint8Array(buffer)
  const tag = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) bytes[offset + i] = text.charCodeAt(i)
  }
  tag(0, 'RIFF')
  output.setUint32(4, buffer.byteLength - 8, true)
  tag(8, 'WAVE')
  let offset = 12
  for (const [name, data] of chunks) {
    tag(offset, name)
    output.setUint32(offset + 4, data.length, true)
    bytes.set(data, offset + 8)
    offset += 8 + data.length + (data.length & 1)
  }
  return buffer
}

test('PCM WAV parsing identifies exact audio bytes and honors padded metadata chunks', () => {
  for (const channels of [1, 2])
    for (const metadata of [false, true]) {
      const buffer = wave({ channels, metadata })
      const original = buffer.slice(0)
      const parsed = parsePcmWave(buffer)
      assert.equal(parsed.sampleRate, 16000)
      assert.equal(parsed.numChannels, channels)
      assert.equal(parsed.frames, 3)
      assert.equal(parsed.durationMs, (3 * 1000) / 16000)
      assert.deepEqual(
        [...new Uint8Array(buffer, parsed.dataOffset, parsed.dataBytes)],
        new Array(6 * channels).fill(42),
      )
      assert.deepEqual(buffer, original)
    }
})

test('wrong magic, truncation, inconsistent headers, empty data and multiple data chunks fail before playback', () => {
  const corruptions = [
    (view: DataView) => view.setUint32(0, 0),
    (view: DataView) => view.setUint32(4, 1, true),
    (view: DataView) => view.setUint32(8, 0),
    (view: DataView) => view.setUint32(16, 15, true),
    (view: DataView) => view.setUint32(28, 1, true),
    (view: DataView) => view.setUint16(32, 3, true),
    (view: DataView) => view.setUint32(40, 5, true),
    (view: DataView) => view.setUint32(40, 7, true),
    (view: DataView) => view.setUint32(40, 0xffffffff, true),
  ]
  for (const corrupt of corruptions) {
    const buffer = wave()
    corrupt(new DataView(buffer))
    assert.throws(() => parsePcmWave(buffer), { code: 'INVALID_ARGUMENT' })
  }
  assert.throws(() => parsePcmWave(wave({ frames: 0 })), { code: 'INVALID_ARGUMENT' })
  const extra = wave({ metadata: true })
  const parsed = parsePcmWave(extra)
  new DataView(extra).setUint32(parsed.dataOffset + parsed.dataBytes, 0x64617461)
  assert.throws(() => parsePcmWave(extra), { code: 'INVALID_ARGUMENT' })
})

test('unsupported PCM formats and playback budgets are explicit failures', () => {
  for (const [offset, value] of [
    [20, 3],
    [22, 3],
    [34, 8],
  ]) {
    const buffer = wave()
    new DataView(buffer).setUint16(offset, value, true)
    assert.throws(() => parsePcmWave(buffer), { code: 'UNSUPPORTED' })
  }
  assert.throws(() => parsePcmWave(wave({ sampleRate: 96000 })), { code: 'UNSUPPORTED' })
  assert.throws(() => parsePcmWave(wave({ frames: 16000 * 60 + 1 })), { code: 'INVALID_ARGUMENT' })
  assert.throws(() => parsePcmWave(new ArrayBuffer(3 * 1024 * 1024 + 1)), { code: 'INVALID_ARGUMENT' })
})
