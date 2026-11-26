import AudioOut from 'embedded:io/audio/out'
import { pcmMagnitudeSum } from 'stackchan/voice/pcm-magnitude'
import { deferred, voiceError } from 'stackchan/voice/scope'
import type { PcmOutput } from './runtime-types.js'

// CoreS3 sets I2S_DMA_BUFFER_MAX_SIZE to 2048. The ESP32 ECMA-419 driver exposes five writable descriptors.
const dmaBlockBytes = 2048
export const minimumOutputBytes = dmaBlockBytes * 5

export function openOutput(
  sampleRate: number,
  volume: number,
  limit: number,
  onLevel?: (value: number) => void,
): PcmOutput {
  const levels: { end: number; sum: number; count: number }[] = []
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
  function emitLevel(value: number) {
    try {
      onLevel?.(value)
    } catch {}
  }
  function publishLevels() {
    while (levels.length && levels[0].end <= confirmed) {
      const level = levels.shift()
      if (level) emitLevel(level.sum / level.count)
    }
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
      publishLevels()
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
      if (onLevel) {
        let start = audioBytes - size
        while (start < audioBytes) {
          const end = Math.min(audioBytes, (Math.floor(start / dmaBlockBytes) + 1) * dmaBlockBytes)
          const count = end - start
          const from = offset + start - (audioBytes - size)
          const sum = (pcmMagnitudeSum(bytes, from, count) / 32768) * volume
          const frames = count / 2
          const previous = levels[levels.length - 1]
          if (previous && Math.floor((previous.end - 1) / dmaBlockBytes) === Math.floor(start / dmaBlockBytes)) {
            previous.end = end
            previous.sum += sum
            previous.count += frames
          } else levels.push({ end, sum, count: frames })
          start = end
        }
      }
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
      volume = gain
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
      publishLevels()
      emitLevel(0)
    },
    close() {
      if (closed) return
      closed = true
      levels.length = 0
      emitLevel(0)
      signal()
      try {
        audio.stop()
      } finally {
        audio.close()
      }
    },
  }
}

export function openBufferedOutput(sampleRate: number, volume: number, limit: number): PcmOutput {
  const pageBytes = dmaBlockBytes * 4
  const dmaHorizon = minimumOutputBytes + dmaBlockBytes
  const maxPadding = dmaHorizon + dmaBlockBytes
  const pages = Math.min(4, Math.floor((limit - minimumOutputBytes - maxPadding) / pageBytes))
  if (pages < 3) throw voiceError('resource_exhausted', 'buffered speaker needs three PCM pages')
  // ESP feeds I2S from its audio task only for nonrelocatable buffers.
  const free: Uint8Array[] = Array.from({ length: pages }, () => new Uint8Array(new SharedArrayBuffer(pageBytes)))
  let staged: Uint8Array | undefined
  let filled = 0,
    queuedPages = 0,
    received = 0,
    accepted = 0
  let started = false,
    sealed = false,
    closed = false,
    tailAccepted = false
  let failure: Error | undefined
  let changed: ReturnType<typeof deferred<void>> | undefined
  const signal = () => {
    changed?.resolve()
    changed = undefined
  }
  const wait = () => {
    changed ??= deferred<void>()
    return changed.promise
  }
  function requireOpen() {
    if (closed) throw voiceError('cancelled')
    if (failure) throw failure
  }
  const format = { sampleRate, bitsPerSample: 16, channels: 1, nativeBuffering: true } as const
  const audio = new AudioOut.Async(format)
  try {
    if (audio.sampleRate !== sampleRate || audio.channels !== 1 || audio.bitsPerSample !== 16)
      throw voiceError('unsupported_capability', 'speaker format negotiation failed')
    const amp = (globalThis as typeof globalThis & { amp?: { sampleRate: number } }).amp
    if (amp) amp.sampleRate = audio.sampleRate
    audio.volume = volume
  } catch (error) {
    audio.close()
    throw error
  }
  function start() {
    if (started) return
    audio.start()
    started = true
  }
  function flush() {
    if (!staged || !filled) return
    const page = staged,
      length = filled
    audio.write(page.subarray(0, length), (error) => {
      if (closed) return
      if (error) failure ??= error
      else accepted += length
      queuedPages--
      free.push(page)
      signal()
    })
    queuedPages++
    staged = undefined
    filled = 0
    if (queuedPages >= 3) start()
  }
  return {
    async write(bytes, onAccepted) {
      let offset = 0
      while (offset < bytes.length) {
        requireOpen()
        if (sealed) throw voiceError('cancelled')
        staged ??= free.pop()
        if (!staged) {
          await wait()
          continue
        }
        const size = Math.min(pageBytes - filled, bytes.length - offset)
        staged.set(bytes.subarray(offset, offset + size), filled)
        offset += size
        filled += size
        received += size
        onAccepted?.(size)
        if (filled === pageBytes) flush()
      }
    },
    get frames() {
      return tailAccepted ? received / 2 : Math.max(0, accepted - dmaHorizon) / 2
    },
    setVolume(gain) {
      audio.volume = gain
    },
    async drain() {
      requireOpen()
      if (!received) return
      sealed = true
      flush()
      // Completion makes a page reusable while its samples can still be in DMA. Queue silence to drain them.
      const padding = dmaHorizon + ((dmaBlockBytes - (received % dmaBlockBytes)) % dmaBlockBytes)
      audio.write(new Uint8Array(new SharedArrayBuffer(padding)), (error) => {
        if (closed) return
        if (error) failure ??= error
        else tailAccepted = true
        signal()
      })
      start()
      while (!tailAccepted) {
        requireOpen()
        await wait()
      }
      requireOpen()
    },
    close() {
      if (closed) return
      closed = true
      signal()
      audio.close()
    },
  }
}
