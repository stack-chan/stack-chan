import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { writeAliasPackageSubpath } from '../../testing/node-alias-package.js'

async function setup() {
  const hostRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
  writeAliasPackageSubpath(hostRoot, 'stackchan', 'errors', resolve(hostRoot, '../sdk/errors.js'))
  writeAliasPackageSubpath(
    hostRoot,
    'stackchan-contracts',
    'audio-recording',
    resolve(hostRoot, '../contracts/audio-recording.js'),
  )
  return import('../recording-wave.js')
}

test('recording WAV header describes complete rounded PCM frames', async () => {
  const { createRecordingWave } = await setup()
  const { buffer, samples, bytesPerFrame } = createRecordingWave(
    { sampleRate: 44_100, channels: 2, bitsPerSample: 16 },
    1.5,
  )
  const view = new DataView(buffer)
  assert.equal(bytesPerFrame, 4)
  assert.equal(samples.byteLength, 67 * 4)
  assert.equal(view.getUint32(4, true), buffer.byteLength - 8)
  assert.equal(view.getUint32(40, true), samples.byteLength)
  assert.equal(view.getUint32(24, true), 44_100)
  assert.equal(view.getUint32(28, true), 44_100 * bytesPerFrame)
  assert.equal(view.getUint16(22, true), 2)
  assert.equal(view.getUint16(34, true), 16)
})

test('recording rejects invalid duration, PCM formats and excess memory before allocating', async () => {
  const { createRecordingWave } = await setup()
  const valid = { sampleRate: 16_000, channels: 1, bitsPerSample: 16 }
  for (const duration of [NaN, Infinity, -1, 0, 15_001])
    assert.throws(() => createRecordingWave(valid, duration), { code: 'INVALID_ARGUMENT' })
  for (const invalid of [
    { ...valid, sampleRate: NaN },
    { ...valid, channels: 3 },
    { ...valid, bitsPerSample: 24 },
  ])
    assert.throws(() => createRecordingWave(invalid, 1), { code: 'IO' })
  assert.throws(() => createRecordingWave({ ...valid, sampleRate: 48_000 }, 15_000), { code: 'INVALID_ARGUMENT' })
  assert.ok(createRecordingWave(valid, 15_000).buffer.byteLength <= 512 * 1024)
})
