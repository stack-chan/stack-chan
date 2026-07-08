import { rgb565LeToPiuColor, sampleRgb565LeMosaic, toPiuColorString } from 'camera-preview-utils'
import { equal } from 'testing/assert'

trace('=== camera-preview utils test ===\n')

const pixels = new Uint8Array([0x00, 0xf8, 0xe0, 0x07, 0x1f, 0x00, 0xff, 0xff]).buffer

equal(toPiuColorString(0x0000ff), '#0000ff', 'Piu color strings should keep leading zeros')
equal(rgb565LeToPiuColor(pixels, 0), 0xff0000, 'red RGB565LE pixel should map to Piu red')
equal(rgb565LeToPiuColor(pixels, 2), 0x00ff00, 'green RGB565LE pixel should map to Piu green')
equal(rgb565LeToPiuColor(pixels, 4), 0x0000ff, 'blue RGB565LE pixel should map to Piu blue')
equal(rgb565LeToPiuColor(pixels, 6), 0xffffff, 'white RGB565LE pixel should map to Piu white')

const whiteFrame = new Uint8Array(4 * 4 * 2)
for (let i = 0; i < whiteFrame.length; i += 2) {
  whiteFrame[i] = 0xff
  whiteFrame[i + 1] = 0xff
}

const blocks = sampleRgb565LeMosaic(
  { width: 4, height: 4, imageType: 'rgb565le', buffer: whiteFrame.buffer },
  { width: 8, height: 8, blockSize: 4 },
)

equal(blocks.length, 4, 'mosaic should produce four sampled blocks')
for (const block of blocks) {
  equal(block.width, 4, 'mosaic block width should match blockSize')
  equal(block.height, 4, 'mosaic block height should match blockSize')
  equal(block.color, 0xffffff, 'mosaic block should sample white pixels')
}

trace('ok\n')
