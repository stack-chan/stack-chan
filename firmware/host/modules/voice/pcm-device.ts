import Modules from 'modules'
import type AudioOutput from 'pins/audioout'
import type {
  AudioSink,
  DuplexLease,
  MediaBudget,
  PcmFormat,
  PlaybackCursor,
  PlaybackLease,
  PlaybackOptions,
  PlaybackReceipt,
} from 'stackchan/voice/contracts'
import { capacity, createPcmSink, createPcmSource, pcmMedia } from 'stackchan/voice/media'
import { pcmEnergy } from 'stackchan/voice/pcm-energy'
import { bindAudioRuntime, type LeaseOptions, type RuntimeOptions } from 'stackchan/voice/runtime'
import { deferred, requireActive, voiceError } from 'stackchan/voice/scope'
import Timer from 'timer'
import type { PairedAudioRuntime, PcmOutput, PcmOutputModule } from './runtime-types.js'

export function createAudioRuntime(options: RuntimeOptions): PairedAudioRuntime {
  return bindAudioRuntime(options, openPcmLease, openPlayback)
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
  | { direct: PcmOutput; drain?: Promise<void> }
  | { lengths: number[]; flush(): void; flushTimer?: ReturnType<typeof Timer.set> }
)

function createCapture(inputFormat: PcmFormat, chunkSize: number, preRoll: number) {
  const AudioIn = Modules.importNow('audio-in') as CaptureConstructor
  const slots = [new Uint8Array(chunkSize), new Uint8Array(chunkSize)]
  const busy = [false, false]
  const input = createPcmSource(inputFormat, preRoll)
  let mic: CaptureDriver | undefined
  let suspended = true
  let enabled = true
  function stopMic() {
    mic?.close()
    mic = undefined
    input.clearHistory()
  }
  function capture() {
    if (suspended || !enabled || mic) return
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
  return {
    input: input.output,
    setSuspended(value: boolean) {
      suspended = value
      if (value) stopMic()
      else capture()
    },
    async setInputEnabled(value: boolean) {
      enabled = value
      if (value) capture()
      else stopMic()
    },
    end() {
      suspended = true
      stopMic()
      input.end()
    },
  }
}

function openPcmLease({ requirements, budget, signal }: LeaseOptions): DuplexLease {
  requireActive(signal)
  if (requirements.duplex === 'full') throw voiceError('unsupported_capability', 'generic device supports half duplex')
  const inputFormat = monoFormat(requirements.input)
  const outputFormat = monoFormat(requirements.output)
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
  if (preRoll < 0 || chunkSize < 2 || outputLimit < 2)
    throw voiceError('resource_exhausted', 'PCM lease exceeds budget')
  const capture = createCapture(inputFormat, chunkSize, preRoll)
  const directLimit = Math.min(capacity(budget, outputFormat), budget.maxBufferedBytes - preRoll - 2 * chunkSize)
  const playback = createPlayback(outputFormat, budget, outputLimit, directLimit, capture.setSuspended)
  capture.setSuspended(false)
  return {
    ...playback,
    input: capture.input,
    setInputEnabled: capture.setInputEnabled,
    async close() {
      capture.end()
      await playback.close()
    },
  }
}

function openPlayback(formats: readonly PcmFormat[], { signal, budget, onPlayed }: PlaybackOptions): PlaybackLease {
  requireActive(signal)
  const format = monoFormat(formats)
  const limit = capacity(budget, format)
  const notify = onPlayed
    ? (power: number) => {
        if (signal.aborted) return
        try {
          onPlayed(power)
        } catch {
          // A presentation callback must not interrupt the hardware driver.
        }
      }
    : undefined
  return createPlayback(format, budget, limit, limit, undefined, notify)
}

function createPlayback(
  outputFormat: PcmFormat,
  budget: MediaBudget,
  outputLimit: number,
  directLimit: number,
  suspendCapture?: (value: boolean) => void,
  onPlayed?: (power: number) => void,
): PlaybackLease {
  const AudioOut = Modules.importNow('pins/audioout') as typeof AudioOutput
  const deviceOutput = Modules.has('stackchan/voice/cores3-pcm-output')
    ? (Modules.importNow('stackchan/voice/cores3-pcm-output', true) as PcmOutputModule)
    : undefined
  const directOutput = deviceOutput && directLimit >= deviceOutput.minimumOutputBytes ? deviceOutput : undefined
  let out: (InstanceType<typeof AudioOutput> & { callback?: (value: number) => void }) | undefined
  let failedClose: unknown
  let closed = false,
    volume = 0.5,
    generation = 0
  const slotBytes = Math.min(2048, Math.floor(outputLimit / 4) * 2)
  if (slotBytes < 2) throw voiceError('resource_exhausted', 'output requires two PCM slots')
  const flushDelayMs = Math.min(12, Math.floor((slotBytes * 500) / outputFormat.sampleRate))
  const slotsOut = directOutput ? [] : [new SharedArrayBuffer(slotBytes), new SharedArrayBuffer(slotBytes)]
  const meteredSlots = onPlayed ? slotsOut.map((buffer) => new Uint8Array(buffer)) : undefined
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
    if (!closed) suspendCapture?.(false)
    return receipt
  }
  function begin(id: string, epoch: number): AudioSink {
    if (closed || epoch !== generation) throw voiceError('cancelled')
    if (active) throw voiceError('device_busy')
    suspendCapture?.(true)
    try {
      if (directOutput) {
        const direct = directOutput.openOutput(outputFormat.sampleRate, volume, directLimit, onPlayed)
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
        const frames = item.lengths[slot] / 2
        item.frames += frames
        const power = meteredSlots ? Math.sqrt(pcmEnergy(meteredSlots[slot], 0, frames * 2) / frames) : 0
        item.lengths[slot] = 0
        wake(item)
        onPlayed?.(power)
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
      suspendCapture?.(false)
      throw error
    }
  }
  const output = {
    ...createPcmSink(outputFormat, () => {
      throw new Error('call begin before writing audio')
    }),
    budget,
    position(id: string): PlaybackCursor {
      if (active?.id !== id) return remembered.get(id)?.position ?? { basis: 'unknown' }
      const renderedFrames = 'direct' in active ? active.direct.frames : active.frames
      return { basis: 'estimate', renderedFrames, sampleRate: outputFormat.sampleRate }
    },
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
  return {
    output,
    media: pcmMedia,
    setVolume(gain) {
      volume = gain
      if (active && 'direct' in active) active.direct.setVolume(volume)
      if (out) out.enqueue(0, AudioOut.Volume, Math.round(volume * 256))
    },
    async close() {
      closed = true
      retire('interrupted')
      if (failedClose) throw failedClose
    },
  }
}
