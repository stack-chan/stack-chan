import assert from 'node:assert/strict'
import { test } from 'node:test'

import { rgb565LeToPiuColor, sampleRgb565LeMosaic } from '../../stackchan/camera-preview-utils.js'

test('rgb565LeToPiuColor converts little-endian RGB565 pixels to 24-bit Piu colors', () => {
  const buffer = new Uint8Array([
    0x00,
    0xf8, // red
    0xe0,
    0x07, // green
    0x1f,
    0x00, // blue
    0xff,
    0xff, // white
  ]).buffer

  assert.equal(rgb565LeToPiuColor(buffer, 0), 0xff0000)
  assert.equal(rgb565LeToPiuColor(buffer, 2), 0x00ff00)
  assert.equal(rgb565LeToPiuColor(buffer, 4), 0x0000ff)
  assert.equal(rgb565LeToPiuColor(buffer, 6), 0xffffff)
})

test('sampleRgb565LeMosaic returns coarse blocks for a Piu-safe preview draw', () => {
  const buffer = new Uint8Array(4 * 4 * 2)
  for (let i = 0; i < buffer.length; i += 2) {
    buffer[i] = 0xff
    buffer[i + 1] = 0xff
  }

  const blocks = sampleRgb565LeMosaic(
    { width: 4, height: 4, imageType: 'rgb565le', buffer: buffer.buffer },
    { width: 8, height: 8, blockSize: 4 },
  )

  assert.deepEqual(blocks, [
    { x: 0, y: 0, width: 4, height: 4, color: 0xffffff },
    { x: 4, y: 0, width: 4, height: 4, color: 0xffffff },
    { x: 0, y: 4, width: 4, height: 4, color: 0xffffff },
    { x: 4, y: 4, width: 4, height: 4, color: 0xffffff },
  ])
})
