/** Return the complete leading ID3v2 tag size, including header and optional footer. */
export function id3Size(header) {
  if (header[0] !== 0x49 || header[1] !== 0x44 || header[2] !== 0x33) return 0
  if (header.length < 10) return undefined
  if (![2, 3, 4].includes(header[3]) || header[4] === 0xff) throw new Error('Unsupported ID3 version')
  let size = 0
  for (let index = 6; index < 10; index += 1) {
    if (header[index] & 0x80) throw new Error('Invalid ID3 size')
    size = size * 128 + header[index]
  }
  return 10 + size + (header[3] === 4 && header[5] & 0x10 ? 10 : 0)
}

/** MPEG-1 Layer III Xing/Info and VBRI frame counts. Never use TOC byte interpolation for seeking. */
export function mp3Duration(frame, info) {
  if (((frame[1] >> 3) & 3) !== 3 || ((frame[1] >> 1) & 3) !== 1) return
  const read32 = (offset) =>
    offset + 4 <= frame.length
      ? frame[offset] * 0x1000000 + (frame[offset + 1] << 16) + (frame[offset + 2] << 8) + frame[offset + 3]
      : 0
  const tag = (offset) => String.fromCharCode(...frame.subarray(offset, offset + 4))
  const offset = 4 + (info.channels === 1 ? 17 : 32)
  let frames = 0
  if (['Xing', 'Info'].includes(tag(offset)) && read32(offset + 4) & 1) frames = read32(offset + 8)
  else if (tag(36) === 'VBRI') frames = read32(50)
  if (frames > 0) return (frames * info.samples) / info.sampleRate
}
