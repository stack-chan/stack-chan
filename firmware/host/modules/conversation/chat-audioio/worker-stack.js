import ChatAudioIOBase from 'ChatAudioIO'
import Worker from 'worker'

const CONNECTION_ENVELOPE = '__stackchanConnectionConfiguration'

export default class ChatAudioIO extends ChatAudioIOBase {
  constructor(options = {}) {
    const providerID =
      options.configuration === undefined
        ? options.providerID
        : {
            [CONNECTION_ENVELOPE]: true,
            configuration: options.configuration,
          }
    super({ ...options, providerID })
    const callback = () => {}
    this.onEmotionChanged = options.onEmotionChanged ?? callback
    this.onAlert = options.onAlert ?? callback
    this.onSystemCommand = options.onSystemCommand ?? callback
    this.onCustomEvent = options.onCustomEvent ?? callback
    this.onUnknownEvent = options.onUnknownEvent ?? callback
    this.onProtocolWarning = options.onProtocolWarning ?? callback
    this.onMcpNotification = options.onMcpNotification ?? callback
    this.onMcpResponse = options.onMcpResponse ?? callback
    this.onGlyphPush = options.onGlyphPush ?? callback
  }

  ensureInput() {
    if (!this.immediateInputReady) {
      super.ensureInput()
      return
    }
    const notify = !this.ready && this.state !== ChatAudioIO.DISCONNECTED
    super.ensureInput()
    if (!this.input || this.ready) return
    this.ready = true
    if (notify) this.onStateChanged(this.state)
  }

  createWorker(specifier, instructions, functions, voiceID, providerID, modelID, apiKey) {
    let configuration
    if (providerID && typeof providerID === 'object' && providerID[CONNECTION_ENVELOPE] === true) {
      configuration = providerID.configuration
      providerID = undefined
    }

    const usesNativePcmRing = specifier === 'xiaozhiV1'
    this.immediateInputReady = usesNativePcmRing
    if (usesNativePcmRing) this.inputSampleRate = 16000

    const worker = new Worker(specifier, {
      static: 512 * 1024,
      chunk: {
        initial: 64 * 1024,
        incremental: 8 * 1024,
      },
      heap: {
        initial: 1024,
        incremental: 256,
      },
      stack: 1024,
      nativeStack: 40 * 1024,
      priority: 4,
    })
    // Shared PCM ring (~1.92 s of 16 kHz mono). Main writes via native
    // downmix; the Opus task reads it. Do not copy samples in JS or wait
    // for a Worker ACK — both previously dropped mic frames.
    const PCM_FRAME_BYTES = 1920
    const PCM_RING_BYTES = PCM_FRAME_BYTES * 32 + 2
    const PCM_RING_STATE_BYTES = 4 * 4
    const pcmRing = usesNativePcmRing ? new SharedArrayBuffer(PCM_RING_BYTES) : undefined
    const pcmRingState = usesNativePcmRing ? new SharedArrayBuffer(PCM_RING_STATE_BYTES) : undefined

    this.worker = {
      terminate: () => worker.terminate(),
      postMessage: (message) => {
        if (message.id !== 'sendAudio' || !usesNativePcmRing) {
          worker.postMessage(message)
          return
        }
        if (!this.inputBuffer || !pcmRing || !pcmRingState) return
        try {
          native('xs_pcm_ring_write_downmix').call(
            this,
            pcmRing,
            pcmRingState,
            this.inputBuffer,
            message.offset,
            message.size,
            message.channels ?? 2,
          )
        } catch (error) {
          this.failed({ string: `PCM ring write failed: ${String(error?.message ?? error)}` })
        }
      },
    }
    worker.onmessage = (message) => {
      if (message.id === 'audioConsumed') return
      const handler = this[message.id]
      if (typeof handler === 'function') {
        handler.call(this, message)
        return
      }
      trace(`[chat] ignored worker message: ${String(message.id)}\n`)
    }
    this.worker.postMessage({
      id: 'configure',
      configuration,
      pcmRing,
      pcmRingState,
      // Legacy fields remain available to existing ChatAudioIO workers.
      instructions,
      functions,
      voiceID,
      providerID,
      modelID,
      apiKey,
    })
    this.ensureInput()
  }

  startListening(mode = 'auto') {
    this.worker?.postMessage({ id: 'startListening', mode })
  }

  stopListening() {
    this.worker?.postMessage({ id: 'stopListening' })
  }

  notifyWakeWordDetected(text) {
    this.worker?.postMessage({ id: 'detectWakeWord', text })
  }

  abort(reason) {
    this.worker?.postMessage({ id: 'abort', reason })
  }

  sendMcpMessage(payload) {
    this.worker?.postMessage({ id: 'sendMcpMessage', payload })
  }

  receiveEmotion(message) {
    this.onEmotionChanged(message.emotion ?? '', message.text)
  }

  receiveAlert(message) {
    this.onAlert({ status: message.status, message: message.message ?? '', emotion: message.emotion })
  }

  receiveSystemCommand(message) {
    this.onSystemCommand({ command: message.command ?? '', event: message.event ?? {} })
  }

  receiveCustomEvent(message) {
    this.onCustomEvent({ payload: message.payload, event: message.event ?? {} })
  }

  receiveUnknownEvent(message) {
    this.onUnknownEvent(message.event ?? {})
  }

  protocolWarning(message) {
    this.onProtocolWarning(message.string ?? 'protocol warning', message.event)
  }

  receiveMcpNotification(message) {
    this.onMcpNotification(message.payload ?? {})
  }

  receiveMcpResponse(message) {
    this.onMcpResponse(message.payload ?? {})
  }

  receiveGlyphPush(message) {
    this.onGlyphPush({ source: message.source, text: message.text, payload: message.payload ?? {} })
  }
}
