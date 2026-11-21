export const SERVICE_UUID = '7fdd3d1c-38ea-46cf-8b46-314ecf5f240c'
export const RX_UUID = '4d593029-28a2-4a6e-a1f0-3c2d5e8f9b01'
export const TX_UUID = 'd75dc4ca-7b2b-4e9c-8f0a-1d2e3f4a5b6c'
export const MAX_RECORD_BYTES = 8192

export function createReceiver() {
  let parts = [],
    size = 0,
    next = 0,
    total = 0
  function reset() {
    for (const part of parts) part.fill(0)
    parts = []
    size = 0
    next = 0
    total = 0
  }
  return {
    reset,
    push(value) {
      const bytes = new Uint8Array(value)
      if (!bytes.length || bytes.length > MAX_RECORD_BYTES) {
        reset()
        throw new Error('invalid_frame')
      }
      if (bytes[0] !== 0xfe) {
        reset()
        return bytes.slice()
      }
      if (bytes.length < 3 || !bytes[2]) {
        reset()
        throw new Error('invalid_frame')
      }
      const index = bytes[1],
        count = bytes[2]
      if (index === 0) {
        reset()
        total = count
      }
      if (count !== total || index !== next || index >= count || size + bytes.length - 3 > MAX_RECORD_BYTES) {
        reset()
        throw new Error('invalid_frame')
      }
      parts.push(bytes.slice(3))
      size += bytes.length - 3
      ++next
      if (next < total) return
      const result = new Uint8Array(size)
      let offset = 0
      for (const part of parts) {
        result.set(part, offset)
        offset += part.length
      }
      reset()
      return result
    },
  }
}

export function* frameRecord(bytes, mtu = 23) {
  const usable = Math.min(mtu - 3, 160) - 3
  if (!Number.isInteger(mtu) || usable < 1 || bytes.length > MAX_RECORD_BYTES) throw new Error('invalid_frame')
  const total = Math.max(1, Math.ceil(bytes.length / usable))
  if (total > 255) throw new Error('invalid_frame')
  for (let index = 0; index < total; ++index) {
    const body = bytes.subarray(index * usable, (index + 1) * usable)
    const frame = new Uint8Array(3 + body.length)
    frame.set([0xfe, index, total])
    frame.set(body, 3)
    yield frame
  }
}
