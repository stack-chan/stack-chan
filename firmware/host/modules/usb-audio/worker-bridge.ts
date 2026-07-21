import AudioOut from 'embedded:io/audio/out'
import {
  SPEAKER_STATS_AUDIO_ACTIVE,
  SPEAKER_STATS_AWAITING_DRAIN,
  SPEAKER_STATS_MAX_WRITABLE_GAP_MS,
  SPEAKER_STATS_WORDS,
  SPEAKER_STATS_WRITABLE_BYTES,
  SPEAKER_STATS_WRITABLE_CALLBACKS,
  SPEAKER_STATS_WRITTEN_BYTES,
} from 'stackchan-usb-shared-output'
import Time from 'time'
import Timer from 'timer'
import { SharedByteRing } from 'web-radio-byte-ring'
import Worker from 'worker'
import { StackChanStatus } from 'stackchan-usb-protocol'
import { CurrentStreamGate } from 'stackchan-usb-stream-gate'

export type UsbAudioPresentation = {
  onStatusChanged(status: StackChanStatus): void
  onPlaybackStarted(): void
  onPlaybackPower(power: number): void
  onPlaybackText(text: string): void
  onPlaybackStopped(): void
}

export type UsbAudioBridgeControl = {
  setPresentation(presentation?: UsbAudioPresentation): void
  close(): void
}

export type UsbAudioBridgeOptions = {
  speakerVolume?: number
  diagnostics?: boolean
}

type UsbAudioWorkerOptions = NonNullable<ConstructorParameters<typeof Worker>[1]> & {
  core: number
  priority: number
}

type AudioOutput = InstanceType<typeof AudioOut>
type PendingCaption = { position: number; text: string }
type UsbAudioWorkerMessage = {
  id?: string
  position?: number
  power?: number
  reason?: string
  sampleRate?: number
  text?: string
  status?: number
  streamId?: number
  volume?: number
}

const SHARED_PCM_RING_BYTES = 64 * 1024
const SPEAKER_DMA_BUFFER_BYTES = 2048
const SPEAKER_DMA_DRAIN_CALLBACKS = 5
const SPEAKER_SILENCE = new Uint8Array(SPEAKER_DMA_BUFFER_BYTES)
const SHARED_PCM_PUMP_MILLISECONDS = 10

const USB_AUDIO_WORKER_OPTIONS: UsbAudioWorkerOptions = {
  static: 192 * 1024,
  chunk: {
    initial: 128 * 1024,
    incremental: 32 * 1024,
  },
  heap: {
    initial: 2048,
    incremental: 256,
  },
  stack: 768,
  nativeStack: 8 * 1024,
  core: 1,
  // The main XS task runs at priority 4. USB polling must preempt a long Piu
  // render, while physical AudioOut consumption remains on the main VM.
  priority: 5,
}

class UsbAudioWorkerBridge implements UsbAudioBridgeControl {
  #worker: Worker | undefined
  #outputRing = SharedByteRing.allocate(SHARED_PCM_RING_BYTES)
  #outputStats = new Int32Array(new SharedArrayBuffer(SPEAKER_STATS_WORDS * Int32Array.BYTES_PER_ELEMENT))
  #audio: AudioOutput | undefined
  #audioStreams = new CurrentStreamGate()
  #audioPumpTimer: ReturnType<typeof Timer.repeat> | undefined
  #audioStarted = false
  #audioEnded = false
  #audioAwaitingDrain = false
  #audioDrainCallbacksRemaining = 0
  #audioWritableBytes = 0
  #audioBlockOffset = 0
  #audioLastWritableTicks = 0
  #pendingCaptions: PendingCaption[] = []
  #presentation: UsbAudioPresentation | undefined
  #presentationActive = false
  #presentationPower = 0
  #presentationText = ''
  #presentationStatus = StackChanStatus.IDLE
  #presentationStreamId = 0

  constructor(options: UsbAudioBridgeOptions = {}) {
    const worker = new Worker('stackchan-usb-audio-worker', USB_AUDIO_WORKER_OPTIONS)
    this.#worker = worker
    worker.onmessage = (message) => this.#handleWorkerMessage(message)
    worker.postMessage({
      id: 'start',
      ...options,
      output: {
        ring: this.#outputRing.buffers,
        stats: this.#outputStats.buffer as SharedArrayBuffer,
      },
    })
  }

  setPresentation(presentation?: UsbAudioPresentation): void {
    if (this.#presentation === presentation) return
    if (this.#presentationActive) this.#notifyPresentation(this.#presentation, 'onPlaybackStopped')
    if (this.#presentationStatus !== StackChanStatus.IDLE) {
      this.#notifyPresentation(this.#presentation, 'onStatusChanged', StackChanStatus.IDLE)
    }
    this.#presentation = presentation
    if (!presentation) return
    this.#notifyPresentation(presentation, 'onStatusChanged', this.#presentationStatus)
    if (this.#presentationActive) {
      this.#notifyPresentation(presentation, 'onPlaybackStarted')
      if (this.#presentationText) this.#notifyPresentation(presentation, 'onPlaybackText', this.#presentationText)
      this.#notifyPresentation(presentation, 'onPlaybackPower', this.#presentationPower)
    }
  }

  close(): void {
    const worker = this.#worker
    this.#worker = undefined
    this.#closeAudio()
    this.#stopPresentation()
    this.#setPresentationStatus(StackChanStatus.IDLE)
    if (!worker) return
    try {
      worker.postMessage({ id: 'close' })
    } catch {
      worker.terminate()
    }
  }

  #handleWorkerMessage(message: UsbAudioWorkerMessage): void {
    switch (message.id) {
      case 'audio-open':
        this.#openAudio(message.sampleRate ?? 0, message.streamId ?? 0)
        break
      case 'audio-volume':
        if (!this.#audioStreams.isCurrent(message.streamId ?? 0)) break
        try {
          if (this.#audio) this.#audio.volume = message.volume ?? 1
        } catch (error) {
          this.#failAudio(error)
        }
        break
      case 'audio-start':
        if (!this.#audioStreams.isCurrent(message.streamId ?? 0)) break
        this.#startAudio()
        break
      case 'audio-data':
        if (!this.#audioStreams.isCurrent(message.streamId ?? 0)) break
        this.#drainAudio()
        break
      case 'audio-end':
        if (!this.#audioStreams.isCurrent(message.streamId ?? 0)) break
        this.#audioEnded = true
        this.#drainAudio()
        break
      case 'audio-close':
        this.#closeAudio(message.streamId ?? 0)
        break
      case 'playback-started':
        if (!this.#audioStreams.isCurrent(message.streamId ?? 0)) break
        this.#presentationStreamId = message.streamId ?? 0
        this.#presentationActive = true
        this.#presentationPower = 0
        this.#presentationText = ''
        this.#pendingCaptions = []
        this.#notifyPresentation(this.#presentation, 'onPlaybackStarted')
        break
      case 'playback-power':
        if (message.streamId !== this.#presentationStreamId) break
        this.#presentationPower = message.power ?? 0
        this.#notifyPresentation(this.#presentation, 'onPlaybackPower', this.#presentationPower)
        break
      case 'playback-text':
        if (message.streamId !== this.#presentationStreamId) break
        if (message.text) this.#pendingCaptions.push({ position: message.position ?? 0, text: message.text })
        this.#flushCaptions()
        break
      case 'playback-stopped':
        if (message.streamId !== this.#presentationStreamId) break
        this.#stopPresentation()
        break
      case 'status-changed':
        if (message.status === undefined) break
        this.#setPresentationStatus(message.status as StackChanStatus)
        break
      case 'error':
        trace(`[usb-audio-worker] ${message.reason ?? 'unknown error'}\n`)
        this.#closeAudio()
        this.#stopPresentation()
        this.#setPresentationStatus(StackChanStatus.IDLE)
        break
      case 'closed':
        this.#worker = undefined
        this.#closeAudio()
        this.#stopPresentation()
        this.#setPresentationStatus(StackChanStatus.IDLE)
        break
    }
  }

  #openAudio(sampleRate: number, streamId: number): void {
    this.#closeAudio()
    this.#audioStreams.activate(streamId)
    if (sampleRate !== 8000 && sampleRate !== 16000 && sampleRate !== 24000) {
      this.#failAudio(new RangeError(`unsupported speaker sample rate: ${sampleRate}`), streamId)
      return
    }

    for (let index = 0; index < this.#outputStats.length; index += 1) {
      Atomics.store(this.#outputStats, index, 0)
    }
    this.#audioStarted = false
    this.#audioEnded = false
    this.#audioAwaitingDrain = false
    this.#audioDrainCallbacksRemaining = 0
    this.#audioWritableBytes = 0
    this.#audioBlockOffset = 0
    this.#audioLastWritableTicks = 0

    const bridge = this
    try {
      const audio = new AudioOut({
        sampleRate,
        channels: 1,
        bitsPerSample: 16,
        onWritable(size: number) {
          bridge.#handleAudioWritable(this, size)
        },
      })
      this.#audio = audio
      const amp = (globalThis as typeof globalThis & { amp?: { sampleRate: number } }).amp
      if (amp) amp.sampleRate = sampleRate
    } catch (error) {
      this.#failAudio(error, streamId)
    }
  }

  #startAudio(): void {
    const audio = this.#audio
    if (!audio || this.#audioStarted) return
    try {
      this.#audioStarted = true
      Atomics.store(this.#outputStats, SPEAKER_STATS_AUDIO_ACTIVE, 1)
      audio.start()
      this.#audioPumpTimer = Timer.repeat(() => this.#drainAudio(), SHARED_PCM_PUMP_MILLISECONDS)
      this.#drainAudio()
    } catch (error) {
      this.#failAudio(error)
    }
  }

  #handleAudioWritable(output: AudioOutput, writable: number): void {
    if (output !== this.#audio || !this.#audioStarted) return
    const now = Time.ticks
    if (this.#audioLastWritableTicks !== 0) {
      const gap = (now - this.#audioLastWritableTicks) >>> 0
      const previousMaximum = Atomics.load(this.#outputStats, SPEAKER_STATS_MAX_WRITABLE_GAP_MS) >>> 0
      if (gap > previousMaximum) {
        Atomics.store(this.#outputStats, SPEAKER_STATS_MAX_WRITABLE_GAP_MS, gap)
      }
    }
    this.#audioLastWritableTicks = now
    Atomics.add(this.#outputStats, SPEAKER_STATS_WRITABLE_CALLBACKS, 1)
    this.#audioWritableBytes = Math.max(0, writable & ~1)
    Atomics.store(this.#outputStats, SPEAKER_STATS_WRITABLE_BYTES, this.#audioWritableBytes)

    if (this.#audioAwaitingDrain) {
      this.#audioDrainCallbacksRemaining -= 1
      if (this.#audioDrainCallbacksRemaining <= 0) this.#finishAudioDrain()
      return
    }
    this.#drainAudio()
  }

  #drainAudio(): void {
    const audio = this.#audio
    if (!audio || !this.#audioStarted || this.#audioAwaitingDrain) return

    let sampleCount = 0
    let sumSquares = 0
    try {
      while (this.#audioWritableBytes >= 2) {
        const source = this.#outputRing.readableView(this.#audioWritableBytes)
        const use = source.byteLength & ~1
        if (use === 0) break
        const samples = use === source.byteLength ? source : source.subarray(0, use)
        for (let offset = 0; offset < samples.byteLength; offset += 2) {
          let sample = samples[offset] | (samples[offset + 1] << 8)
          if (sample & 0x8000) sample -= 0x10000
          sumSquares += sample * sample
          sampleCount += 1
        }
        audio.write(samples)
        this.#outputRing.advanceRead(use)
        Atomics.add(this.#outputStats, SPEAKER_STATS_WRITTEN_BYTES, use)
        this.#audioWritableBytes -= use
        this.#audioBlockOffset = (this.#audioBlockOffset + use) % SPEAKER_DMA_BUFFER_BYTES
        Atomics.store(this.#outputStats, SPEAKER_STATS_WRITABLE_BYTES, this.#audioWritableBytes)
      }

      if (sampleCount > 0) {
        this.#presentationPower = Math.sqrt(sumSquares / sampleCount)
        this.#notifyPresentation(this.#presentation, 'onPlaybackPower', this.#presentationPower)
      } else if (this.#outputRing.readableBytes === 0) {
        this.#presentationPower = 0
        this.#notifyPresentation(this.#presentation, 'onPlaybackPower', 0)
      }
      this.#flushCaptions()

      if (!this.#audioEnded || this.#outputRing.readableBytes !== 0) return
      const padding = this.#audioBlockOffset === 0 ? 0 : SPEAKER_DMA_BUFFER_BYTES - this.#audioBlockOffset
      if (padding > this.#audioWritableBytes) return
      if (padding > 0) {
        audio.write(SPEAKER_SILENCE.subarray(0, padding))
        this.#audioWritableBytes -= padding
        this.#audioBlockOffset = 0
        Atomics.store(this.#outputStats, SPEAKER_STATS_WRITABLE_BYTES, this.#audioWritableBytes)
      }
      this.#audioAwaitingDrain = true
      this.#audioDrainCallbacksRemaining = SPEAKER_DMA_DRAIN_CALLBACKS
      Atomics.store(this.#outputStats, SPEAKER_STATS_AWAITING_DRAIN, 1)
      this.#presentationPower = 0
      this.#notifyPresentation(this.#presentation, 'onPlaybackPower', 0)
    } catch (error) {
      this.#failAudio(error)
    }
  }

  #finishAudioDrain(): void {
    const worker = this.#worker
    const streamId = this.#audioStreams.current
    this.#flushCaptions()
    this.#closeAudio()
    worker?.postMessage({ id: 'audio-drained', streamId })
  }

  #failAudio(error: unknown, streamId = this.#audioStreams.current): void {
    trace(`[usb-audio] AudioOut failed: ${error instanceof Error ? error.message : String(error)}\n`)
    const worker = this.#worker
    this.#closeAudio()
    worker?.postMessage({ id: 'audio-failed', streamId })
  }

  #closeAudio(expectedStreamId?: number): void {
    if (expectedStreamId !== undefined && !this.#audioStreams.isCurrent(expectedStreamId)) return
    const streamId = this.#audioStreams.current
    const audio = this.#audio
    this.#audio = undefined
    if (this.#audioPumpTimer) Timer.clear(this.#audioPumpTimer)
    this.#audioPumpTimer = undefined
    this.#audioStarted = false
    this.#audioEnded = false
    this.#audioAwaitingDrain = false
    this.#audioDrainCallbacksRemaining = 0
    this.#audioWritableBytes = 0
    this.#audioBlockOffset = 0
    this.#audioLastWritableTicks = 0
    Atomics.store(this.#outputStats, SPEAKER_STATS_AUDIO_ACTIVE, 0)
    Atomics.store(this.#outputStats, SPEAKER_STATS_AWAITING_DRAIN, 0)
    Atomics.store(this.#outputStats, SPEAKER_STATS_WRITABLE_BYTES, 0)
    this.#presentationPower = 0
    this.#notifyPresentation(this.#presentation, 'onPlaybackPower', 0)
    if (streamId) this.#audioStreams.clearIfCurrent(streamId)
    if (!audio) return
    try {
      audio.stop()
    } catch {}
    try {
      audio.close()
    } catch {}
  }

  #flushCaptions(): void {
    const writtenBytes = Atomics.load(this.#outputStats, SPEAKER_STATS_WRITTEN_BYTES) >>> 0
    while (this.#pendingCaptions.length > 0 && this.#pendingCaptions[0].position <= writtenBytes) {
      const caption = this.#pendingCaptions.shift()
      if (!caption) break
      this.#presentationText = caption.text
      this.#notifyPresentation(this.#presentation, 'onPlaybackText', caption.text)
    }
  }

  #setPresentationStatus(status: StackChanStatus): void {
    if (this.#presentationStatus === status) return
    this.#presentationStatus = status
    this.#notifyPresentation(this.#presentation, 'onStatusChanged', status)
  }

  #stopPresentation(): void {
    if (this.#presentationActive) this.#notifyPresentation(this.#presentation, 'onPlaybackStopped')
    this.#presentationActive = false
    this.#presentationPower = 0
    this.#presentationText = ''
    this.#pendingCaptions = []
    this.#presentationStreamId = 0
  }

  #notifyPresentation(
    presentation: UsbAudioPresentation | undefined,
    method: keyof UsbAudioPresentation,
    value?: number | string,
  ): void {
    if (!presentation) return
    try {
      if (value === undefined) (presentation[method] as () => void)()
      else if (typeof value === 'number') (presentation[method] as (next: number) => void)(value)
      else (presentation[method] as (next: string) => void)(value)
    } catch (error) {
      trace(`[usb-audio] presentation ${method} failed: ${error instanceof Error ? error.message : String(error)}\n`)
    }
  }
}

let bridge: UsbAudioWorkerBridge | undefined

export function startUsbAudioBridge(options: UsbAudioBridgeOptions = {}): UsbAudioBridgeControl {
  if (!bridge) bridge = new UsbAudioWorkerBridge(options)
  return bridge
}

export function stopUsbAudioBridge(): void {
  bridge?.close()
  bridge = undefined
}

export default startUsbAudioBridge
