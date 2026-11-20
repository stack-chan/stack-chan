// SPDX-License-Identifier: Apache-2.0
// Lossless PNG of captured simulator framebuffers (no image libraries needed).
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../dist/avatar-dsl-render')
const width = 960,
  height = 1440,
  pixels = Buffer.alloc((width * 3 + 1) * height)
for (let preset = 0; preset < 3; preset++)
  for (let emotion = 0; emotion < 6; emotion++) {
    const frame = 1 + preset * 24 + emotion * 2
    const data = readFileSync(path.join(directory, `frame-${String(frame).padStart(3, '0')}.rgba`))
    if (data.length !== 320 * 240 * 4) throw new Error('Unexpected framebuffer dimensions')
    // The reused Linux screen ABI stores BGRA despite its legacy .rgba suffix.
    for (let y = 0; y < 240; y++)
      for (let x = 0; x < 320; x++) {
        const source = (y * 320 + x) * 4,
          target = (emotion * 240 + y) * (width * 3 + 1) + 1 + (preset * 320 + x) * 3
        pixels[target] = data[source + 2]
        pixels[target + 1] = data[source + 1]
        pixels[target + 2] = data[source]
      }
  }
function crc32(data) {
  let crc = 0xffffffff
  for (const byte of data) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]),
    result = Buffer.alloc(body.length + 8)
  result.writeUInt32BE(data.length)
  body.copy(result, 4)
  result.writeUInt32BE(crc32(body), body.length + 4)
  return result
}
const header = Buffer.alloc(13)
header.writeUInt32BE(width)
header.writeUInt32BE(height, 4)
header[8] = 8
header[9] = 2
writeFileSync(
  path.join(directory, 'contact-sheet.png'),
  Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels)),
    chunk('IEND', Buffer.alloc(0)),
  ]),
)
writeFileSync(
  path.join(directory, 'contact-sheet.html'),
  '<!doctype html><meta charset="utf-8"><title>Avatar DSL Piu QA</title><style>body{background:#222;color:#eee;font:16px sans-serif}img{width:960px;max-width:100%}</style><h1>Avatar DSL Piu QA</h1><p>Columns: default / omega / aokko. Rows: NEUTRAL / ANGRY / SAD / HAPPY / SLEEPY / DOUBTFUL. Cheeks and accessory 0 enabled.</p><img src="contact-sheet.png" alt="Three presets in six emotions">',
)
console.log(path.join(directory, 'contact-sheet.png'))
