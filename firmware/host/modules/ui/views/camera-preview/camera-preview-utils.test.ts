import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  copyRgb565Frame,
  copyRgb565LeFrame,
  rgb565LeToPiuColor,
  rgb565ToPiuColor,
  sampleRgb565LeMosaic,
  sampleRgb565Mosaic,
  toPiuColorString,
} from './camera-preview-utils.js'

test('toPiuColorString formats 24-bit Piu colors with leading zeros', () => {
  assert.equal(toPiuColorString(0x0000ff), '#0000ff')
  assert.equal(toPiuColorString(0x123456), '#123456')
})

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

test('rgb565ToPiuColor converts big-endian RGB565 pixels to 24-bit Piu colors', () => {
  const buffer = new Uint8Array([
    0xf8,
    0x00, // red
    0x07,
    0xe0, // green
    0x00,
    0x1f, // blue
    0xff,
    0xff, // white
  ]).buffer

  assert.equal(rgb565ToPiuColor(buffer, 0, 'be'), 0xff0000)
  assert.equal(rgb565ToPiuColor(buffer, 2, 'be'), 0x00ff00)
  assert.equal(rgb565ToPiuColor(buffer, 4, 'be'), 0x0000ff)
  assert.equal(rgb565ToPiuColor(buffer, 6, 'be'), 0xffffff)
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

test('sampleRgb565Mosaic supports big-endian RGB565 frames', () => {
  const buffer = new Uint8Array([
    0xf8,
    0x00, // red
    0x07,
    0xe0, // green
    0x00,
    0x1f, // blue
    0xff,
    0xff, // white
  ])

  const blocks = sampleRgb565Mosaic(
    { width: 2, height: 2, imageType: 'rgb565be', buffer: buffer.buffer },
    { width: 2, height: 2, blockSize: 1 },
  )

  assert.deepEqual(blocks, [
    { x: 0, y: 0, width: 1, height: 1, color: 0xff0000 },
    { x: 1, y: 0, width: 1, height: 1, color: 0x00ff00 },
    { x: 0, y: 1, width: 1, height: 1, color: 0x0000ff },
    { x: 1, y: 1, width: 1, height: 1, color: 0xffffff },
  ])
})

test('copyRgb565LeFrame scales a camera frame into a retained preview buffer', () => {
  const source = new Uint8Array([
    0x00,
    0xf8, // red
    0xe0,
    0x07, // green
    0x1f,
    0x00, // blue
    0xff,
    0xff, // white
  ])

  const copied = new Uint8Array(
    copyRgb565LeFrame(
      {
        width: 2,
        height: 2,
        imageType: 'rgb565le',
        buffer: source.buffer,
      },
      { width: 4, height: 2 },
    ),
  )

  assert.deepEqual(
    [...copied],
    [0x00, 0xf8, 0x00, 0xf8, 0xe0, 0x07, 0xe0, 0x07, 0x1f, 0x00, 0x1f, 0x00, 0xff, 0xff, 0xff, 0xff],
  )
  assert.notEqual(copied.buffer, source.buffer)
})

test('copyRgb565Frame can produce big-endian RGB565 for RGB565BE displays', () => {
  const source = new Uint8Array([
    0x00,
    0xf8, // red in RGB565LE
    0xe0,
    0x07, // green in RGB565LE
  ])

  const copied = new Uint8Array(
    copyRgb565Frame(
      {
        width: 2,
        height: 1,
        imageType: 'rgb565le',
        buffer: source.buffer,
      },
      { width: 2, height: 1, byteOrder: 'be' },
    ),
  )

  assert.deepEqual([...copied], [0xf8, 0x00, 0x07, 0xe0])
})

test('copyRgb565Frame keeps big-endian RGB565 frames in display byte order', () => {
  const source = new Uint8Array([
    0xf8,
    0x00, // red in RGB565BE
    0x07,
    0xe0, // green in RGB565BE
  ])

  const copied = new Uint8Array(
    copyRgb565Frame(
      {
        width: 2,
        height: 1,
        imageType: 'rgb565be',
        buffer: source.buffer,
      },
      { width: 2, height: 1, byteOrder: 'be' },
    ),
  )

  assert.deepEqual([...copied], [0xf8, 0x00, 0x07, 0xe0])
  assert.notEqual(copied.buffer, source.buffer)
})
