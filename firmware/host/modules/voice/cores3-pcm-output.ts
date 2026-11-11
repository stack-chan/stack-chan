import AudioOut from 'embedded:io/audio/out'
import { deferred, voiceError } from 'stackchan/voice/scope'

// CoreS3 sets I2S_DMA_BUFFER_MAX_SIZE to 2048. The ESP32 ECMA-419 driver exposes five writable descriptors.
const dmaBlockBytes = 2048
export const minimumOutputBytes = dmaBlockBytes * 5

export function openOutput(sampleRate: number, volume: number, limit: number) {
  let capacity = 0
  let writable = 0
  let submitted = 0
  let audioBytes = 0
  let confirmed = 0
  let closed = false
  let change: ReturnType<typeof deferred<void>> | undefined
  const signal = () => {
    change?.resolve()
    change = undefined
  }
  const wait = () => {
    change ??= deferred<void>()
    return change.promise
  }
  const requireOpen = () => {
    if (closed) throw voiceError('cancelled')
  }
  const audio = new AudioOut({
    sampleRate,
    bitsPerSample: 16,
    channels: 1,
    onWritable(size) {
      if (closed) return
      if (!capacity) capacity = size
      writable = size
      confirmed = Math.max(confirmed, Math.min(audioBytes, submitted - (capacity - writable) - dmaBlockBytes))
      signal()
    },
  })
  try {
    if (audio.sampleRate !== sampleRate || audio.channels !== 1 || audio.bitsPerSample !== 16)
      throw voiceError('unsupported_capability', 'speaker format negotiation failed')
    const amp = (globalThis as typeof globalThis & { amp?: { sampleRate: number } }).amp
    if (amp) amp.sampleRate = audio.sampleRate
    audio.volume = volume
    audio.start()
  } catch (error) {
    audio.close()
    throw error
  }

  function submit(bytes: Uint8Array, offset: number, onAccepted?: (size: number) => void) {
    requireOpen()
    const credit = Math.min(writable, limit - (capacity - writable)) & ~1
    const size = Math.min(Math.max(0, credit), bytes.length - offset)
    if (size) {
      audio.write(size === bytes.length ? bytes : bytes.subarray(offset, offset + size))
      writable -= size
      submitted += size
      audioBytes += size
      onAccepted?.(size)
    }
    return offset + size
  }

  async function writeRemainder(bytes: Uint8Array, offset: number, onAccepted?: (size: number) => void) {
    while (offset < bytes.length) {
      requireOpen()
      await wait()
      offset = submit(bytes, offset, onAccepted)
    }
  }

  function write(bytes: Uint8Array, onAccepted?: (size: number) => void) {
    const offset = submit(bytes, 0, onAccepted)
    if (offset < bytes.length) return writeRemainder(bytes, offset, onAccepted)
  }

  return {
    write,
    get frames() {
      return confirmed / 2
    },
    setVolume(gain: number) {
      audio.volume = gain
    },
    async drain() {
      requireOpen()
      if (!audioBytes) return
      // Flush the partial native block, then replace the DMA ring with silence. Only a subsequent
      // hardware credit confirms the last real descriptor has left the peripheral.
      let padding = capacity + dmaBlockBytes + ((dmaBlockBytes - (audioBytes % dmaBlockBytes)) % dmaBlockBytes)
      const silence = new Uint8Array(dmaBlockBytes)
      while (padding > 0) {
        requireOpen()
        if (!writable) {
          await wait()
          continue
        }
        const size = Math.min(padding, writable, silence.length)
        audio.write(size === silence.length ? silence : silence.subarray(0, size))
        writable -= size
        submitted += size
        padding -= size
      }
      await wait()
      requireOpen()
      confirmed = audioBytes
    },
    close() {
      if (closed) return
      closed = true
      signal()
      try {
        audio.stop()
      } finally {
        audio.close()
      }
    },
  }
}
