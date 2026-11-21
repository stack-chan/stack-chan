import { pcmLevel } from 'stackchan/voice/levels'

export const minimumOutputBytes = 4092
const DMA_BYTES = 4092
const DMA_COUNT = 6

export function openOutput(sampleRate, volume, limit, onLevel) {
  if (sampleRate !== 16000 || limit < minimumOutputBytes) throw new RangeError('StopWatch audio requires 16 kHz')
  const staged = new Uint8Array(DMA_BYTES)
  let stagedBytes = 0
  let credit = 0,
    wake
  let driver,
    pending,
    closed = false,
    busy = false,
    frames = 0,
    drainTask
  const cancelled = () => Object.assign(new Error('audio closed'), { code: 'cancelled' })
  async function send(bytes) {
    let offset = 0
    while (offset < bytes.length) {
      if (closed) throw cancelled()
      if (!credit) {
        await new Promise((resolve, reject) => {
          wake = resolve
          pending = reject
        })
        continue
      }
      const count = Math.min(credit, bytes.length - offset) & ~1
      if (!count) throw new Error('unaligned speaker credit')
      driver.write(bytes.subarray(offset, offset + count))
      credit -= count
      offset += count
    }
  }
  async function submitAudio(bytes) {
    const level = onLevel && pcmLevel(bytes) * volume
    await send(bytes)
    if (!closed) onLevel?.(level)
  }
  try {
    driver = new device.audio.Output({
      sampleRate,
      channels: 1,
      bitsPerSample: 16,
      onWritable(bytes) {
        if (closed) return
        credit = bytes
        const resume = wake
        wake = undefined
        pending = undefined
        resume?.()
      },
    })
    driver.volume = volume
    driver.start()
  } catch (error) {
    driver?.close()
    throw error
  }
  return {
    get frames() {
      return frames
    },
    setVolume(gain) {
      if (closed) throw cancelled()
      volume = Math.max(0, Math.min(1, gain))
      driver.volume = volume
    },
    async write(bytes, onAccepted) {
      if (closed) throw cancelled()
      if (busy || drainTask || bytes.byteLength & 1 || bytes.byteLength > limit)
        throw new RangeError('unaccepted StopWatch PCM')
      busy = true
      try {
        for (let offset = 0; offset < bytes.byteLength;) {
          if (closed) throw cancelled()
          const count = Math.min(DMA_BYTES - stagedBytes, bytes.byteLength - offset)
          const piece = bytes.subarray(offset, offset + count)
          staged.set(piece, stagedBytes)
          stagedBytes += count
          offset += count
          frames += count / 2
          onAccepted?.(count)
          // Coalesce decoder frames, then use all available native DMA credit
          // before waiting. The native ring is separate from this bounded stage.
          if (stagedBytes === DMA_BYTES) {
            await submitAudio(staged)
            stagedBytes = 0
          }
        }
      } finally {
        busy = false
      }
    },
    drain() {
      if (busy) return Promise.reject(new Error('write still pending'))
      if (!drainTask)
        drainTask = (async () => {
          if (stagedBytes) {
            await submitAudio(staged.subarray(0, stagedBytes))
            stagedBytes = 0
          }
          // Writable credit acknowledges DMA space, not playback. A full ring
          // of silence pushes preceding PCM past all six hardware descriptors.
          const quiet = staged
          quiet.fill(0)
          for (let i = 0; i < DMA_COUNT + 1; i++) await send(quiet)
        })()
      return drainTask
    },
    close() {
      if (closed) return
      closed = true
      stagedBytes = 0
      const reject = pending
      pending = undefined
      wake = undefined
      try {
        driver.close()
      } finally {
        reject?.(cancelled())
      }
    },
  }
}

