import { voiceError } from 'stackchan/voice/scope'

type BodyReader = { read(target: Uint8Array): number | undefined }

// HTTP readability reports the current byte count. Retain it while the speaker has no capacity.
export function createPcmBodyReader(consume: (bytes: Uint8Array) => Promise<void>, finish: (error?: unknown) => void) {
  const scratch = new Uint8Array(2048)
  let reader: BodyReader,
    available = 0,
    reading = false,
    ended = false,
    closed = false,
    carry = -1
  function settle(error?: unknown) {
    if (closed) return
    closed = true
    finish(error)
  }
  async function pump() {
    if (reading || closed) return
    reading = true
    try {
      while (available > 0 && !closed) {
        const offset = carry < 0 ? 0 : 1
        if (offset) scratch[0] = carry
        const size = Math.min(available, scratch.length - offset)
        const count = reader.read(scratch.subarray(offset, offset + size)) ?? 0
        if (count <= 0 || count > size) throw voiceError('provider_failed', 'invalid PCM body read')
        available -= count
        const length = offset + count
        carry = length % 2 ? scratch[length - 1] : -1
        const aligned = length & ~1
        if (aligned) await consume(aligned === scratch.length ? scratch : scratch.subarray(0, aligned))
      }
      if (ended && !closed) settle(carry < 0 ? undefined : voiceError('provider_failed', 'truncated PCM sample'))
    } catch (error) {
      settle(error)
    } finally {
      reading = false
    }
  }
  return {
    ready(body: BodyReader, count: number) {
      if (closed) return
      reader = body
      available = count
      void pump()
    },
    done(error?: unknown) {
      if (error) settle(error)
      else {
        ended = true
        void pump()
      }
    },
    close() {
      closed = true
    },
  }
}
