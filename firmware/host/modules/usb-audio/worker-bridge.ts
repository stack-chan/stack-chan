import AudioIn from 'embedded:io/audio/in'
import AudioOut from 'embedded:io/audio/out'
import { readAudioInputChunk } from 'stackchan-usb-audio-input-read'
import { UsbEventSendRequests } from 'stackchan-usb-event-send-requests'
import type { UsbEventSendResult, UsbEventTransportState } from 'stackchan-usb-event-transport'
import { StackChanStatus } from 'stackchan-usb-media-session'
import {
  resetSharedSpeakerOutputState,
  SPEAKER_STATS_AUDIO_ACTIVE,
  SPEAKER_STATS_AWAITING_DRAIN,
  SPEAKER_STATS_MAX_WRITABLE_GAP_MS,
  SPEAKER_STATS_WORDS,
  SPEAKER_STATS_WRITABLE_BYTES,
  SPEAKER_STATS_WRITABLE_CALLBACKS,
  SPEAKER_STATS_WRITTEN_BYTES,
} from 'stackchan-usb-shared-output'
import { CurrentStreamGate } from 'stackchan-usb-stream-gate'
import Time from 'time'
import Timer from 'timer'
import { SharedByteRing } from 'web-radio-byte-ring'
import Worker from 'worker'

export type UsbAudioPresentation = {
  onStatusChanged(status: StackChanStatus): void
  onPlaybackStarted(): void
  onPlaybackPower(power: number): void
  onPlaybackText(text: string): void
  onPlaybackStopped(): void
}

export type UsbAudioBridgeControl = {
  setPresentation(presentation?: UsbAudioPresentation): void
  setStatusHandler(handler?: (status: StackChanStatus) => void): void
  setEventHandler(handler?: (event: string) => void): void
  setTransportStateHandler(handler?: (state: UsbEventTransportState) => void): void
  sendEvent(event: string): Promise<UsbEventSendResult>
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
type AudioInput = InstanceType<typeof AudioIn>
type PendingCaption = { position: number; text: string }
type UsbAudioWorkerMessage = {
  bitsPerSample?: number
  channels?: number
  id?: string
  position?: number
  power?: number
  reason?: string
  requestId?: number
  result?: UsbEventSendResult
  sampleRate?: number
  text?: string
  event?: string
  status?: number
  streamId?: number
  transportState?: UsbEventTransportState
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
  // The main XS task runs at priority 4. USB callbacks must preempt a long Piu
  // render, while physical AudioOut consumption remains on the main VM.
  priority: 5,
}

class UsbAudioWorkerBridge implements UsbAudioBridgeControl {
  #worker: Worker | undefined
  #outputRing = SharedByteRing.allocate(SHARED_PCM_RING_BYTES)
  #outputStats = new Int32Array(new SharedArrayBuffer(SPEAKER_STATS_WORDS * Int32Array.BYTES_PER_ELEMENT))
  #microphone: AudioInput | undefined
  #microphoneStreams = new CurrentStreamGate()
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
  #statusHandler: ((status: StackChanStatus) => void) | undefined
  #eventHandler: ((event: string) => void) | undefined
  #transportStateHandler: ((state: UsbEventTransportState) => void) | undefined
  #transportState: UsbEventTransportState = 'disconnected'
  #eventSends = new UsbEventSendRequests()

  constructor(options: UsbAudioBridgeOptions = {}) {
    const worker = new Worker('stackchan-usb-audio-worker', USB_AUDIO_WORKER_OPTIONS)
    try {
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
    } catch (error) {
      this.#worker = undefined
      try {
        worker.terminate()
      } catch {}
      throw error
    }
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

  setStatusHandler(handler?: (status: StackChanStatus) => void): void {
    this.#statusHandler = handler
    if (handler) this.#notifyStatus(handler, this.#presentationStatus)
  }

  setEventHandler(handler?: (event: string) => void): void {
    this.#eventHandler = handler
  }

  setTransportStateHandler(handler?: (state: UsbEventTransportState) => void): void {
    this.#transportStateHandler = handler
    if (handler) this.#notifyTransportState(handler, this.#transportState)
  }

  sendEvent(event: string): Promise<UsbEventSendResult> {
    const worker = this.#worker
    if (!worker) return Promise.resolve('disconnected')
    const request = this.#eventSends.begin()
    try {
      worker.postMessage({ id: 'send-event', requestId: request.requestId, event })
    } catch (error) {
      this.#eventSends.reject(request.requestId, asError(error))
    }
    return request.result
  }

  close(): void {
    if (bridge === this) bridge = undefined
    const worker = this.#worker
    this.#worker = undefined
    this.#setTransportState('disconnected')
    this.#eventSends.settleAll('disconnected')
    this.#closeMicrophone()
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
      case 'microphone-open':
        this.#openMicrophone(
          message.sampleRate ?? 0,
          message.channels ?? 0,
          message.bitsPerSample ?? 0,
          message.streamId ?? 0,
        )
        break
      case 'microphone-close':
        this.#closeMicrophone(message.streamId ?? 0)
        break
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
      case 'event':
        if (message.event !== undefined) this.#eventHandler?.(message.event)
        break
      case 'transport-state':
        if (isUsbEventTransportState(message.transportState)) this.#setTransportState(message.transportState)
        break
      case 'send-event-result':
        if (message.requestId !== undefined && isUsbEventSendResult(message.result)) {
          this.#eventSends.resolve(message.requestId, message.result)
        }
        break
      case 'send-event-error':
        if (message.requestId !== undefined) {
          this.#eventSends.reject(message.requestId, new Error(message.reason ?? 'USB EVENT send failed'))
        }
        break
      case 'error':
        trace(`[usb-audio-worker] ${message.reason ?? 'unknown error'}\n`)
        try {
          this.#worker?.terminate()
        } catch {}
        this.#worker = undefined
        if (bridge === this) bridge = undefined
        this.#setTransportState('disconnected')
        this.#eventSends.rejectAll(new Error(message.reason ?? 'USB audio worker failed'))
        this.#closeMicrophone()
        this.#closeAudio()
        this.#stopPresentation()
        this.#setPresentationStatus(StackChanStatus.IDLE)
        break
      case 'closed':
        this.#worker = undefined
        if (bridge === this) bridge = undefined
        this.#setTransportState('disconnected')
        this.#eventSends.settleAll('disconnected')
        this.#closeMicrophone()
        this.#closeAudio()
        this.#stopPresentation()
        this.#setPresentationStatus(StackChanStatus.IDLE)
        break
    }
  }

  #setTransportState(state: UsbEventTransportState): void {
    if (state === this.#transportState) return
    this.#transportState = state
    this.#notifyTransportState(this.#transportStateHandler, state)
  }

  #notifyTransportState(
    handler: ((state: UsbEventTransportState) => void) | undefined,
    state: UsbEventTransportState,
  ): void {
    if (!handler) return
    try {
      handler(state)
    } catch (error) {
      trace(`[usb-audio] transport-state handler failed: ${error instanceof Error ? error.message : String(error)}\n`)
    }
  }

  #openMicrophone(sampleRate: number, channels: number, bitsPerSample: number, streamId: number): void {
    this.#closeMicrophone()
    try {
      this.#microphoneStreams.activate(streamId)
    } catch (error) {
      this.#failMicrophone(error, streamId)
      return
    }
    if (sampleRate !== 16000 || channels !== 1 || bitsPerSample !== 16) {
      this.#failMicrophone(
        new RangeError(
          `unsupported microphone format: ${sampleRate} Hz, ${channels} channel(s), ${bitsPerSample} bits`,
        ),
        streamId,
      )
      return
    }
    if (this.#audio) {
      this.#failMicrophone(new Error('speaker output is active'), streamId)
      return
    }

    const bridge = this
    try {
      const microphone = new AudioIn({
        sampleRate,
        channels,
        bitsPerSample,
        onReadable(size: number) {
          bridge.#handleMicrophoneReadable(this, size)
        },
      })
      this.#microphone = microphone
      microphone.start()
      this.#worker?.postMessage({ id: 'microphone-started', streamId })
    } catch (error) {
      this.#failMicrophone(error, streamId)
    }
  }

  #handleMicrophoneReadable(input: AudioInput, size: number): void {
    const streamId = this.#microphoneStreams.current
    const worker = this.#worker
    if (input !== this.#microphone || !streamId || !worker || size <= 0) return
    try {
      const bytes = readAudioInputChunk(input, size)
      if (!bytes) return
      worker.postMessage({ id: 'microphone-data', streamId, data: bytes })
    } catch (error) {
      this.#failMicrophone(error, streamId)
    }
  }

  #failMicrophone(error: unknown, streamId = this.#microphoneStreams.current): void {
    trace(`[usb-audio] AudioIn failed: ${error instanceof Error ? error.message : String(error)}\n`)
    const worker = this.#worker
    this.#closeMicrophone()
    worker?.postMessage({
      id: 'microphone-failed',
      streamId,
      reason: error instanceof Error ? error.message : String(error),
    })
  }

  #closeMicrophone(expectedStreamId?: number): void {
    if (expectedStreamId !== undefined && !this.#microphoneStreams.isCurrent(expectedStreamId)) return
    const streamId = this.#microphoneStreams.current
    const microphone = this.#microphone
    this.#microphone = undefined
    if (streamId) this.#microphoneStreams.clearIfCurrent(streamId)
    if (!microphone) return
    try {
      microphone.close()
    } catch {}
  }

  #openAudio(sampleRate: number, streamId: number): void {
    this.#closeAudio()
    try {
      this.#audioStreams.activate(streamId)
    } catch (error) {
      this.#failAudio(error, streamId)
      return
    }
    if (sampleRate !== 8000 && sampleRate !== 16000 && sampleRate !== 24000) {
      this.#failAudio(new RangeError(`unsupported speaker sample rate: ${sampleRate}`), streamId)
      return
    }
    if (this.#microphone) {
      this.#failAudio(new Error('microphone input is active'), streamId)
      return
    }

    resetSharedSpeakerOutputState(this.#outputRing, this.#outputStats)
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
      this.#worker?.postMessage({ id: 'audio-opened', streamId })
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
    this.#notifyStatus(this.#statusHandler, status)
    this.#notifyPresentation(this.#presentation, 'onStatusChanged', status)
  }

  #notifyStatus(handler: ((status: StackChanStatus) => void) | undefined, status: StackChanStatus): void {
    if (!handler) return
    try {
      handler(status)
    } catch (error) {
      trace(`[usb-audio] status handler failed: ${error instanceof Error ? error.message : String(error)}\n`)
    }
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

function isUsbEventTransportState(value: unknown): value is UsbEventTransportState {
  return value === 'disconnected' || value === 'unsupported' || value === 'ready'
}

function isUsbEventSendResult(value: unknown): value is UsbEventSendResult {
  return value === 'queued' || value === 'overflow' || value === 'disconnected' || value === 'unsupported'
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}
