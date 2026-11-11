import Modules from 'modules'
import type AudioOutput from 'pins/audioout'
import type { AudioSink, DuplexLease, PcmFormat, PlaybackReceipt } from 'stackchan/voice/contracts'
import type * as CoreS3Output from 'stackchan/voice/cores3-pcm-output'
import { capacity, createPcmSink, createPcmSource, pcmMedia } from 'stackchan/voice/media'
import { bindAudioRuntime, type LeaseOptions, type RuntimeOptions } from 'stackchan/voice/runtime'
import { deferred, requireActive, voiceError } from 'stackchan/voice/scope'
import Timer from 'timer'

export function createAudioRuntime(options: RuntimeOptions) {
  return bindAudioRuntime(options, openPcmLease)
}

interface CaptureDriver {
  readonly channels: number
  readonly sampleRate: number
  read(into: Uint8Array): number | Uint8Array | undefined
  start(): void
  close(): void
}
type CaptureConstructor = new (options: {
  channels: number
  sampleRate: number
  bitsPerSample: number
  onReadable(this: CaptureDriver, bytes: number): void
}) => CaptureDriver

function monoFormat(formats: readonly PcmFormat[]) {
  const format = formats.find(
    (f) =>
      f.encoding === 'pcm_s16le' &&
      f.channels === 1 &&
      Number.isInteger(f.sampleRate) &&
      f.sampleRate >= 8000 &&
      f.sampleRate <= 48000,
  )
  if (!format) throw voiceError('unsupported_capability', 'mono PCM at 8–48 kHz required')
  return format
}
type OutputSegment = {
  id: string
  generation: number
  frames: number
  wake?: ReturnType<typeof deferred<void>>
  writing: boolean
  sealed: boolean
} & (
  | { direct: ReturnType<typeof CoreS3Output.openOutput>; drain?: Promise<void> }
  | { lengths: number[]; flush(): void; flushTimer?: ReturnType<typeof Timer.set> }
)

function openPcmLease({ requirements, budget, signal }: LeaseOptions): DuplexLease {
  requireActive(signal)
  if (requirements.duplex === 'full') throw voiceError('unsupported_capability', 'generic device supports half duplex')
  const inputFormat = monoFormat(requirements.input)
  const outputFormat = monoFormat(requirements.output)
  const AudioIn = Modules.importNow('audio-in') as CaptureConstructor
  const AudioOut = Modules.importNow('pins/audioout') as typeof AudioOutput
  const directionBudget = {
    maxBufferedMs: budget.maxBufferedMs / 2,
    maxBufferedBytes: Math.floor(budget.maxBufferedBytes / 2),
  }
  const inputLimit = capacity(directionBudget, inputFormat)
  const outputCapacity = capacity(directionBudget, outputFormat)
  if (Math.min(inputLimit, outputCapacity) < 2) throw voiceError('resource_exhausted')
  const preRoll = Math.ceil(((requirements.preRollMs ?? 0) * inputFormat.sampleRate) / 1000) * 2
  const chunkSize = Math.min(2048, Math.floor((inputLimit - preRoll) / 4) * 2)
  const outputLimit = Math.min(outputCapacity, budget.maxBufferedBytes - preRoll - 2 * chunkSize)
  const deviceOutput = Modules.has('stackchan/voice/cores3-pcm-output')
    ? (Modules.importNow('stackchan/voice/cores3-pcm-output', true) as typeof CoreS3Output)
    : undefined
  const directLimit = Math.min(capacity(budget, outputFormat), budget.maxBufferedBytes - preRoll - 2 * chunkSize)
  const directOutput = deviceOutput && directLimit >= deviceOutput.minimumOutputBytes ? deviceOutput : undefined
  if (preRoll < 0 || chunkSize < 2 || outputLimit < 2)
    throw voiceError('resource_exhausted', 'PCM lease exceeds budget')
  const slots = [new Uint8Array(chunkSize), new Uint8Array(chunkSize)]
  const busy = [false, false]
  const input = createPcmSource(inputFormat, preRoll)
  let mic: CaptureDriver | undefined
  let out: (InstanceType<typeof AudioOutput> & { callback?: (value: number) => void }) | undefined
  let failedClose: unknown
  let closed = false,
    enabled = true,
    volume = 0.5,
    generation = 0
  const slotBytes = Math.min(2048, Math.floor(outputLimit / 4) * 2)
  if (slotBytes < 2) throw voiceError('resource_exhausted', 'output requires two PCM slots')
  const flushDelayMs = Math.min(12, Math.floor((slotBytes * 500) / outputFormat.sampleRate))
  const slotsOut = directOutput ? [] : [new SharedArrayBuffer(slotBytes), new SharedArrayBuffer(slotBytes)]
  let active: OutputSegment | undefined
  function wake(item: OutputSegment) {
    item.wake?.resolve()
    item.wake = undefined
  }
  function progress(item: OutputSegment) {
    item.wake ??= deferred<void>()
    return item.wake.promise
  }
  const remembered = new Map<string, PlaybackReceipt>()

  function stopMic() {
    mic?.close()
    mic = undefined
    input.clearHistory()
  }
  function closeOutput() {
    try {
      out?.close()
    } catch (error) {
      failedClose = error
      throw error
    } finally {
      out = undefined
    }
  }
  function capture() {
    if (closed || !enabled || active || mic) return
    mic = new AudioIn({
      channels: inputFormat.channels,
      sampleRate: inputFormat.sampleRate,
      bitsPerSample: 16,
      onReadable(size: number) {
        if (this !== mic) return
        let remaining = size
        while (remaining >= 2) {
          const slot = busy[0] ? 1 : 0
          if (busy[slot]) {
            input.end(voiceError('input_overrun'))
            stopMic()
            break
          }
          const count = Math.min(remaining, chunkSize) & ~1
          const bytes = count === chunkSize ? slots[slot] : slots[slot].subarray(0, count)
          if (!this.read(bytes)) break
          remaining -= count
          try {
            const writing = input.offer(bytes)
            if (writing) {
              busy[slot] = true
              void writing
                .finally(() => {
                  busy[slot] = false
                })
                .catch(() => {})
            }
          } catch {
            /* The failed reader receives its overrun through its link. */
          }
        }
      },
    })
    try {
      if (mic.sampleRate !== inputFormat.sampleRate || mic.channels !== inputFormat.channels)
        throw voiceError('unsupported_capability', 'microphone format negotiation failed')
      mic.start()
    } catch (error) {
      stopMic()
      throw error
    }
  }
  function retire(state: PlaybackReceipt['state']): PlaybackReceipt | undefined {
    const item = active
    if (!item) return
    active = undefined
    if (!('direct' in item) && item.flushTimer !== undefined) Timer.clear(item.flushTimer)
    try {
      if ('direct' in item) {
        item.frames = item.direct.frames
        try {
          item.direct.close()
        } catch (error) {
          failedClose = error
          throw error
        }
      } else out?.stop()
    } finally {
      try {
        closeOutput()
      } finally {
        wake(item)
      }
    }
    const receipt: PlaybackReceipt = {
      outputId: item.id,
      generation: item.generation,
      state,
      position: { basis: 'estimate', renderedFrames: item.frames, sampleRate: outputFormat.sampleRate },
    }
    remembered.set(item.id, receipt)
    if (remembered.size > 8) {
      const first = remembered.keys().next()
      if (!first.done) remembered.delete(first.value)
    }
    capture()
    return receipt
  }
  function begin(id: string, epoch: number): AudioSink {
    if (closed || epoch !== generation) throw voiceError('cancelled')
    if (active) throw voiceError('device_busy')
    stopMic()
    try {
      if (directOutput) {
        const direct = directOutput.openOutput(outputFormat.sampleRate, volume, directLimit)
        const item: OutputSegment = {
          id,
          generation,
          frames: 0,
          writing: false,
          sealed: false,
          direct,
        }
        active = item
        const onFailure = (error: unknown): never => {
          if (active === item) retire('failed')
          throw error
        }
        const write = (bytes: Uint8Array, onAccepted?: (size: number) => void) => {
          if (active !== item || item.sealed) throw voiceError('cancelled')
          if (item.writing || bytes.length % 2 || (!onAccepted && bytes.length > directLimit))
            throw voiceError('resource_exhausted', 'unaccepted PCM output')
          item.writing = true
          try {
            const pending = direct.write(bytes, onAccepted)
            if (pending)
              return pending.catch(onFailure).finally(() => {
                item.writing = false
                wake(item)
              })
            item.writing = false
          } catch (error) {
            item.writing = false
            onFailure(error)
          }
        }
        return Object.assign(createPcmSink(outputFormat, write), { writeBorrowed: write })
      }
      out = new AudioOut({ streams: 1, sampleRate: outputFormat.sampleRate, bitsPerSample: 16, numChannels: 1 })
      const driver = out
      let stagedSlot = -1
      let stagedBytes = 0
      const item: Extract<OutputSegment, { lengths: number[] }> = {
        id,
        generation,
        frames: 0,
        lengths: [0, 0],
        flush() {
          if (item.flushTimer !== undefined) {
            Timer.clear(item.flushTimer)
            item.flushTimer = undefined
          }
          if (!stagedBytes) return
          const slot = stagedSlot
          const size = stagedBytes
          stagedSlot = -1
          stagedBytes = 0
          item.lengths[slot] = size
          driver.enqueue(0, AudioOut.RawSamples, slotsOut[slot] as unknown as HostBuffer, 1, 0, size / 2)
          driver.enqueue(0, AudioOut.Callback, slot + 1)
        },
        writing: false,
        sealed: false,
      }
      active = item
      out.enqueue(0, AudioOut.Volume, Math.round(volume * 256))
      out.callback = (callbackId: number) => {
        const slot = callbackId - 1
        if (active !== item || !(item.lengths[slot] > 0)) return
        item.frames += item.lengths[slot] / 2
        item.lengths[slot] = 0
        wake(item)
      }
      out.start()
      return createPcmSink(outputFormat, async (bytes) => {
        if (active !== item || item.sealed) throw voiceError('cancelled')
        if (item.writing || bytes.byteLength > outputLimit || bytes.byteLength % 2)
          throw voiceError('resource_exhausted', 'unaccepted PCM output')
        item.writing = true
        try {
          let offset = 0
          while (offset < bytes.length) {
            if (active !== item) throw voiceError('cancelled')
            const slot = stagedSlot < 0 ? item.lengths.indexOf(0) : stagedSlot
            if (slot < 0) {
              await progress(item)
              continue
            }
            stagedSlot = slot
            const size = Math.min(slotBytes - stagedBytes, bytes.length - offset)
            new Uint8Array(slotsOut[slot], stagedBytes, size).set(bytes.subarray(offset, offset + size))
            stagedBytes += size
            offset += size
            if (stagedBytes === slotBytes) item.flush()
          }
          if (stagedBytes && flushDelayMs === 0) item.flush()
          else if (stagedBytes && item.flushTimer === undefined) {
            item.flushTimer = Timer.set(() => {
              item.flushTimer = undefined
              if (active !== item) return
              try {
                item.flush()
              } catch {
                retire('failed')
              }
            }, flushDelayMs)
          }
        } catch (error) {
          if (active === item) retire('failed')
          throw error
        } finally {
          item.writing = false
          wake(item)
        }
      })
    } catch (error) {
      active = undefined
      closeOutput()
      capture()
      throw error
    }
  }
  const output = {
    ...createPcmSink(outputFormat, () => {
      throw new Error('call begin before writing audio')
    }),
    budget,
    begin,
    async finish(id: string) {
      if (active?.id === id) {
        const item = active
        item.sealed = true
        while (active === item && item.writing) await progress(item)
        if (active === item) {
          try {
            if ('direct' in item) {
              item.drain ??= item.direct.drain()
              await item.drain
            } else item.flush()
          } catch {
            if (active === item) retire('failed')
          }
        }
        while (active === item && !('direct' in item) && item.lengths.some((size) => size > 0)) await progress(item)
        if (active === item) retire('played')
      }
      const result = remembered.get(id)
      if (!result) throw voiceError('cancelled', 'unknown audio output')
      return result
    },
    async fence(next: number) {
      if (next <= generation) throw voiceError('cancelled', 'stale generation')
      generation = next
      const receipt = retire('interrupted')
      return receipt ? [receipt] : []
    },
  }
  capture()
  return {
    input: input.output,
    output,
    media: pcmMedia,
    async setInputEnabled(value) {
      if (!closed) {
        enabled = value
        if (value) capture()
        else stopMic()
      }
    },
    setVolume(gain) {
      volume = gain
      if (active && 'direct' in active) active.direct.setVolume(volume)
      if (out) out.enqueue(0, AudioOut.Volume, Math.round(volume * 256))
    },
    async close() {
      closed = true
      stopMic()
      retire('interrupted')
      input.end()
      if (failedClose) throw failedClose
    },
  }
}
