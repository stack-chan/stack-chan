export const Encode = {
  toAlaw(source, target) {
    const samples = source.byteLength >> 1
    for (let index = 0; index < samples; index += 1) {
      target[index] = source[index * 2 + 1] ^ 0x55
    }
  },
}
