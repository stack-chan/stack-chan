export default function checksum(bytes) {
  return native('xs_stackchan_crc32')(bytes)
}
