export function findLF(bytes, offset) {
  return bytes.indexOf(10, offset)
}
