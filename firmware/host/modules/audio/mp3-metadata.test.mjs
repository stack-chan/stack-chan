import assert from 'node:assert/strict'
import { test } from 'node:test'
import { scan } from './mp3-frames.js'
import { id3Size, mp3Duration } from './mp3-metadata.js'

Math.idiv ??= (a, b) => Math.trunc(a / b)
test('ID3 sizes include headers and v2.4 footers without reading artwork', () => {
  for (const version of [2, 3, 4]) {
    const bytes = new Uint8Array([73, 68, 51, version, 0, 0, 0, 32, 0, 0])
    assert.equal(id3Size(bytes), 524298)
    bytes[5] = 16
    assert.equal(id3Size(bytes), version === 4 ? 524308 : 524298)
  }
  assert.equal(id3Size(new Uint8Array([73, 68, 51])), undefined)
  assert.equal(id3Size(new Uint8Array([255, 251])), 0)
  assert.throws(() => id3Size(new Uint8Array([73, 68, 51, 4, 0, 0, 128, 0, 0, 0])))
})
test('MP3 scanning identifies rates, channel count and VBR frame sizes', () => {
  for (const [header, rate, length] of [
    [0x90, 44100, 417],
    [0x94, 48000, 384],
    [0xa0, 44100, 522],
  ]) {
    const bytes = new Uint8Array([0, 0, 255, 251, header, 0xc0])
    const frame = scan(bytes, 0, bytes.length)
    assert.equal(frame.sampleRate, rate)
    assert.equal(frame.position, 2)
    assert.equal(frame.length, length)
    assert.equal(frame.channels, 1)
  }
})

test('Xing/Info and VBRI durations use frame counts, including mono layout', () => {
  for (const tag of ['Xing', 'Info', 'VBRI'])
    for (const channels of [1, 2]) {
      const bytes = new Uint8Array(417)
      bytes.set([255, 251, 0x90, channels === 1 ? 0xc0 : 0])
      const offset = tag === 'VBRI' ? 36 : channels === 1 ? 21 : 36
      bytes.set(Buffer.from(tag), offset)
      const view = new DataView(bytes.buffer)
      if (tag !== 'VBRI') view.setUint32(offset + 4, 1)
      view.setUint32(tag === 'VBRI' ? 50 : offset + 8, 1000)
      const info = scan(bytes, 0, bytes.length)
      assert.equal(mp3Duration(bytes, info), (1000 * 1152) / 44100)
      assert.equal(mp3Duration(bytes.subarray(0, offset + 4), info), undefined)
    }
})
