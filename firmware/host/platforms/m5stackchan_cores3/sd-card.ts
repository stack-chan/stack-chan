const nativeList = native('xs_stackchan_sdcard_list')
const nativeRead = native('xs_stackchan_sdcard_read')
const nativeXsVersionRange = native('xs_stackchan_sdcard_xs_version_range')

const sdCard = Object.freeze({
  list(): string[] {
    return nativeList.call(undefined) as string[]
  },
  read(name: string, maximumBytes: number): ArrayBuffer {
    return nativeRead.call(undefined, name, maximumBytes) as ArrayBuffer
  },
  xsVersionRange(): readonly [number, number, number, number] {
    const bytes = new Uint8Array(nativeXsVersionRange.call(undefined) as ArrayBuffer)
    return [bytes[0], bytes[1], bytes[2], bytes[3]]
  },
})

export default sdCard
