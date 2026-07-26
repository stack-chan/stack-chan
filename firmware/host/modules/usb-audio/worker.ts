import startUsbAudioBridge, {
  type UsbAudioBridgeControl,
  type UsbAudioMicrophoneInput,
  type UsbAudioMicrophoneInputFactory,
  type UsbAudioMicrophoneInputOptions,
  type UsbAudioPresentation,
} from 'stackchan-usb-audio-core'
import type { UsbEventTransportState } from 'stackchan-usb-event-transport'
import { type SharedSpeakerOutputBuffers, SharedSpeakerOutputService } from 'stackchan-usb-shared-output'
import type { Self } from 'worker'

declare const self: Self

let bridge: UsbAudioBridgeControl | undefined
let inputService: MainMicrophoneInputService | undefined
let outputService: SharedSpeakerOutputService | undefined

type PostMessage = (message: Record<string, unknown>) => void

class MainMicrophoneInput implements UsbAudioMicrophoneInput {
  readonly #options: UsbAudioMicrophoneInputOptions
  readonly #postMessage: PostMessage
  #active = false
  #closed = false
  #startPosted = false

  constructor(options: UsbAudioMicrophoneInputOptions, postMessage: PostMessage) {
    this.#options = options
    this.#postMessage = postMessage
  }

  get streamId(): number {
    return this.#options.streamId
  }

  start(): void {
    if (this.#closed || this.#startPosted) return
    this.#startPosted = true
    this.#postMessage({
      id: 'microphone-open',
      streamId: this.streamId,
      sampleRate: this.#options.sampleRate,
      channels: this.#options.channels,
      bitsPerSample: this.#options.bitsPerSample,
    })
  }

  close(): void {
    if (this.#closed) return
    this.#closed = true
    this.#active = false
    this.#postMessage({ id: 'microphone-close', streamId: this.streamId })
  }

  handleStarted(): void {
    if (this.#closed || this.#active || !this.#startPosted) return
    this.#active = true
    this.#options.onStarted.call(this)
  }

  handleReadable(bytes: Uint8Array): void {
    if (this.#closed || !this.#active || bytes.byteLength === 0) return
    this.#options.onReadable.call(this, bytes)
  }

  handleFailed(): void {
    if (this.#closed) return
    this.#active = false
    this.#options.onError.call(this)
  }
}

class MainMicrophoneInputService {
  readonly #postMessage: PostMessage
  #current: MainMicrophoneInput | undefined

  constructor(postMessage: PostMessage) {
    this.#postMessage = postMessage
  }

  readonly createInput: UsbAudioMicrophoneInputFactory = (options) => {
    this.#current?.close()
    const input = new MainMicrophoneInput(options, this.#postMessage)
    this.#current = input
    return input
  }

  handleStarted(streamId: number): void {
    if (this.#current?.streamId !== streamId) return
    this.#current.handleStarted()
  }

  handleReadable(streamId: number, bytes: Uint8Array): void {
    if (this.#current?.streamId !== streamId) return
    this.#current.handleReadable(bytes)
  }

  handleFailed(streamId: number): void {
    const input = this.#current
    if (input?.streamId !== streamId) return
    input.handleFailed()
    if (this.#current === input) this.#current = undefined
  }

  close(): void {
    this.#current?.close()
    this.#current = undefined
  }
}

const presentation: UsbAudioPresentation = {
  onStatusChanged(status) {
    self.postMessage({ id: 'status-changed', status })
  },
  onPlaybackStarted() {
    self.postMessage({ id: 'playback-started', streamId: outputService?.streamId ?? 0 })
  },
  onPlaybackPower() {},
  onPlaybackText(text) {
    self.postMessage({
      id: 'playback-text',
      text,
      position: outputService?.writtenBytes ?? 0,
      streamId: outputService?.streamId ?? 0,
    })
  },
  onPlaybackStopped() {
    self.postMessage({ id: 'playback-stopped', streamId: outputService?.streamId ?? 0 })
  },
}

const onEvent = (event: string) => self.postMessage({ id: 'event', event })
const onTransportState = (transportState: UsbEventTransportState) =>
  self.postMessage({ id: 'transport-state', transportState })

function closeWorker(): void {
  bridge?.setTransportStateHandler(undefined)
  bridge?.close()
  bridge = undefined
  inputService?.close()
  inputService = undefined
  outputService?.close()
  outputService = undefined
  try {
    self.postMessage({ id: 'closed' })
  } finally {
    self.close()
  }
}

function startWorker(message: {
  speakerVolume?: number
  diagnostics?: boolean
  output?: SharedSpeakerOutputBuffers
}): void {
  if (bridge) return
  if (!message.output) throw new TypeError('shared speaker output is required')
  const nextInputService = new MainMicrophoneInputService((next) => self.postMessage(next))
  const nextOutputService = new SharedSpeakerOutputService(message.output, (next) => self.postMessage(next))
  let nextBridge: UsbAudioBridgeControl | undefined
  try {
    nextBridge = startUsbAudioBridge({
      speakerVolume: message.speakerVolume,
      diagnostics: message.diagnostics,
      createMicrophoneInput: nextInputService.createInput,
      createSpeakerOutput: nextOutputService.createOutput,
    })
    nextBridge.setPresentation(presentation)
    nextBridge.setEventHandler(onEvent)
    nextBridge.setTransportStateHandler(onTransportState)
    self.postMessage({ id: 'ready' })
    inputService = nextInputService
    outputService = nextOutputService
    bridge = nextBridge
  } catch (error) {
    try {
      nextBridge?.setPresentation(undefined)
    } catch {}
    try {
      nextBridge?.setEventHandler(undefined)
    } catch {}
    try {
      nextBridge?.setTransportStateHandler(undefined)
    } catch {}
    try {
      nextBridge?.close()
    } catch {}
    try {
      nextInputService.close()
    } catch {}
    try {
      nextOutputService.close()
    } catch {}
    throw error
  }
}

self.onmessage = (message: {
  id?: string
  speakerVolume?: number
  diagnostics?: boolean
  bitsPerSample?: number
  channels?: number
  data?: Uint8Array | ArrayBuffer
  output?: SharedSpeakerOutputBuffers
  sampleRate?: number
  streamId?: number
  event?: string
  requestId?: number
}) => {
  try {
    switch (message.id) {
      case 'start':
        startWorker(message)
        break
      case 'audio-drained':
        outputService?.handleDrained(message.streamId ?? 0)
        break
      case 'audio-opened':
        outputService?.handleOpened(message.streamId ?? 0)
        break
      case 'audio-failed':
        outputService?.handleFailed(message.streamId ?? 0)
        break
      case 'microphone-started':
        inputService?.handleStarted(message.streamId ?? 0)
        break
      case 'microphone-data':
        if (message.data) {
          const bytes = message.data instanceof Uint8Array ? message.data : new Uint8Array(message.data)
          inputService?.handleReadable(message.streamId ?? 0, bytes)
        }
        break
      case 'microphone-failed':
        inputService?.handleFailed(message.streamId ?? 0)
        break
      case 'send-event':
        try {
          if (message.requestId === undefined) throw new TypeError('EVENT send request ID is required')
          if (message.event === undefined) throw new TypeError('EVENT payload is required')
          self.postMessage({
            id: 'send-event-result',
            requestId: message.requestId,
            result: bridge?.sendEvent(message.event) ?? 'disconnected',
          })
        } catch (error) {
          self.postMessage({
            id: 'send-event-error',
            requestId: message.requestId,
            reason: error instanceof Error ? error.message : String(error),
          })
        }
        break
      case 'close':
        closeWorker()
        break
    }
  } catch (error) {
    self.postMessage({ id: 'error', reason: error instanceof Error ? error.message : String(error) })
  }
}
