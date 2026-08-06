export const Encode = {
  toAlaw(source, target) {
    target.set(source.subarray(0, target.length))
  },
}
