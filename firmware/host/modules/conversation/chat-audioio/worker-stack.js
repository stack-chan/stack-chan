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

    const requiresAudioAcknowledgement = specifier === 'xiaozhiV1'
    this.immediateInputReady = requiresAudioAcknowledgement

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
    let audioInFlight = false
    this.worker = {
      terminate: () => worker.terminate(),
      postMessage: (message) => {
        if (message.id !== 'sendAudio' || !requiresAudioAcknowledgement) {
          worker.postMessage(message)
          return
        }
        if (audioInFlight) return
        audioInFlight = true
        try {
          worker.postMessage(message)
        } catch (error) {
          audioInFlight = false
          throw error
        }
      },
    }
    worker.onmessage = (message) => {
      if (message.id === 'audioConsumed') {
        audioInFlight = false
        return
      }
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
