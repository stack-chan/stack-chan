import type { VoiceSignal } from 'stackchan/voice/contracts'
import { requireActive, voiceError } from 'stackchan/voice/scope'

// A bounded native decode boundary shared by Base64 PCM providers. Consumers borrow
// each aligned block only until offer settles; no byte/sample loops belong in providers.
export function createBase64PcmWriter(
  signal: VoiceSignal,
  offer: (bytes: Uint8Array) => void | Promise<void>,
  maxBytes: number,
) {
  const block = new Uint8Array(4096)
  let total = 0,
    carry: number | undefined,
    busy = false
  return {
    get bytes() {
      return total
    },
    get partial() {
      return carry !== undefined
    },
    async write(data: string) {
      requireActive(signal)
      if (busy) throw voiceError('device_busy')
      if (!data.length || data.length % 4) throw voiceError('provider_failed', 'invalid audio encoding')
      const expected = (data.length / 4) * 3 - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0)
      if (total + expected > maxBytes) throw voiceError('resource_exhausted', 'speech audio exceeds limit')
      const decode = (
        Uint8Array as typeof Uint8Array & {
          fromBase64?: (data: string, options: { lastChunkHandling: string }) => Uint8Array
        }
      ).fromBase64
      if (!decode) throw voiceError('unsupported_capability', 'native Base64 decoder required')
      let bytes: Uint8Array
      try {
        bytes = decode(data, { lastChunkHandling: 'strict' })
      } catch (error) {
        if (error instanceof SyntaxError) throw voiceError('provider_failed', 'invalid audio encoding')
        throw error
      }
      if (bytes.length !== expected) throw voiceError('provider_failed', 'invalid audio length')
      busy = true
      try {
        let used = 0
        if (carry !== undefined) {
          block[used++] = carry
          carry = undefined
        }
        for (let at = 0; at < bytes.length; ) {
          const count = Math.min(block.length - used, bytes.length - at)
          block.set(bytes.subarray(at, at + count), used)
          used += count
          at += count
          if (used === block.length) {
            requireActive(signal)
            const pending = offer(block)
            if (pending) await pending
            requireActive(signal)
            used = 0
          }
        }
        if (used & 1) carry = block[--used]
        if (used) {
          const pending = offer(block.subarray(0, used))
          if (pending) await pending
          requireActive(signal)
        }
        total += expected
      } finally {
        busy = false
      }
    },
  }
}
