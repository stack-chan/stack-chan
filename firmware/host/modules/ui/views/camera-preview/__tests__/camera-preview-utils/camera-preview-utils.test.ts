import {
  copyRgb565Frame,
  copyRgb565LeFrame,
  rgb565LeToPiuColor,
  rgb565ToPiuColor,
  sampleRgb565LeMosaic,
  sampleRgb565Mosaic,
  toPiuColorString,
} from 'camera-preview-utils'
import { assert, equal } from 'testing/assert'

trace('=== camera-preview utils test ===\n')

equal(toPiuColorString(0x0000ff), '#0000ff', 'Piu color strings should keep leading zeros')
equal(toPiuColorString(0x123456), '#123456', 'Piu color strings should format 24-bit colors')

const lePixels = new Uint8Array([0x00, 0xf8, 0xe0, 0x07, 0x1f, 0x00, 0xff, 0xff]).buffer

equal(rgb565LeToPiuColor(lePixels, 0), 0xff0000, 'red RGB565LE pixel should map to Piu red')
equal(rgb565LeToPiuColor(lePixels, 2), 0x00ff00, 'green RGB565LE pixel should map to Piu green')
equal(rgb565LeToPiuColor(lePixels, 4), 0x0000ff, 'blue RGB565LE pixel should map to Piu blue')
equal(rgb565LeToPiuColor(lePixels, 6), 0xffffff, 'white RGB565LE pixel should map to Piu white')

const bePixels = new Uint8Array([0xf8, 0x00, 0x07, 0xe0, 0x00, 0x1f, 0xff, 0xff]).buffer

equal(rgb565ToPiuColor(bePixels, 0, 'be'), 0xff0000, 'red RGB565BE pixel should map to Piu red')
equal(rgb565ToPiuColor(bePixels, 2, 'be'), 0x00ff00, 'green RGB565BE pixel should map to Piu green')
equal(rgb565ToPiuColor(bePixels, 4, 'be'), 0x0000ff, 'blue RGB565BE pixel should map to Piu blue')
equal(rgb565ToPiuColor(bePixels, 6, 'be'), 0xffffff, 'white RGB565BE pixel should map to Piu white')

type MosaicBlock = { x: number; y: number; width: number; height: number; color: number }

function equalBlocks(actual: MosaicBlock[], expected: MosaicBlock[], label: string): void {
  equal(actual.length, expected.length, `${label}: block count`)
  for (let i = 0; i < expected.length; i++) {
    equal(actual[i].x, expected[i].x, `${label}: block ${i} x`)
    equal(actual[i].y, expected[i].y, `${label}: block ${i} y`)
    equal(actual[i].width, expected[i].width, `${label}: block ${i} width`)
    equal(actual[i].height, expected[i].height, `${label}: block ${i} height`)
    equal(actual[i].color, expected[i].color, `${label}: block ${i} color`)
  }
}

const whiteFrame = new Uint8Array(4 * 4 * 2)
for (let i = 0; i < whiteFrame.length; i += 2) {
  whiteFrame[i] = 0xff
  whiteFrame[i + 1] = 0xff
}

const leBlocks = sampleRgb565LeMosaic(
  { width: 4, height: 4, imageType: 'rgb565le', buffer: whiteFrame.buffer },
  { width: 8, height: 8, blockSize: 4 },
)

equalBlocks(
  leBlocks,
  [
    { x: 0, y: 0, width: 4, height: 4, color: 0xffffff },
    { x: 4, y: 0, width: 4, height: 4, color: 0xffffff },
    { x: 0, y: 4, width: 4, height: 4, color: 0xffffff },
    { x: 4, y: 4, width: 4, height: 4, color: 0xffffff },
  ],
  'LE mosaic',
)

const beBlocks = sampleRgb565Mosaic(
  { width: 2, height: 2, imageType: 'rgb565be', buffer: bePixels },
  { width: 2, height: 2, blockSize: 1 },
)

equalBlocks(
  beBlocks,
  [
    { x: 0, y: 0, width: 1, height: 1, color: 0xff0000 },
    { x: 1, y: 0, width: 1, height: 1, color: 0x00ff00 },
    { x: 0, y: 1, width: 1, height: 1, color: 0x0000ff },
    { x: 1, y: 1, width: 1, height: 1, color: 0xffffff },
  ],
  'BE mosaic',
)

function equalBytes(actual: Uint8Array, expected: number[], label: string): void {
  equal(actual.length, expected.length, `${label}: byte length`)
  for (let i = 0; i < expected.length; i++) {
    equal(actual[i], expected[i], `${label}: byte ${i}`)
  }
}

const scaleSource = new Uint8Array([0x00, 0xf8, 0xe0, 0x07, 0x1f, 0x00, 0xff, 0xff])
const scaled = new Uint8Array(
  copyRgb565LeFrame(
    { width: 2, height: 2, imageType: 'rgb565le', buffer: scaleSource.buffer },
    { width: 4, height: 2 },
  ),
)
equalBytes(
  scaled,
  [0x00, 0xf8, 0x00, 0xf8, 0xe0, 0x07, 0xe0, 0x07, 0x1f, 0x00, 0x1f, 0x00, 0xff, 0xff, 0xff, 0xff],
  'scaled LE frame',
)
assert(scaled.buffer !== scaleSource.buffer, 'copyRgb565LeFrame should retain a new buffer')

const leToBeSource = new Uint8Array([0x00, 0xf8, 0xe0, 0x07])
const leToBe = new Uint8Array(
  copyRgb565Frame(
    { width: 2, height: 1, imageType: 'rgb565le', buffer: leToBeSource.buffer },
    { width: 2, height: 1, byteOrder: 'be' },
  ),
)
equalBytes(leToBe, [0xf8, 0x00, 0x07, 0xe0], 'LE source copied into BE display order')

const beSource = new Uint8Array([0xf8, 0x00, 0x07, 0xe0])
const beCopy = new Uint8Array(
  copyRgb565Frame(
    { width: 2, height: 1, imageType: 'rgb565be', buffer: beSource.buffer },
    { width: 2, height: 1, byteOrder: 'be' },
  ),
)
equalBytes(beCopy, [0xf8, 0x00, 0x07, 0xe0], 'BE source kept in display byte order')
assert(beCopy.buffer !== beSource.buffer, 'copyRgb565Frame should retain a new buffer')

trace('ok\n')
