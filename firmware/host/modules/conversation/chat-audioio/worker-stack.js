import ChatAudioIOBase from 'ChatAudioIO'
import Worker from 'worker'

const MAX_QUEUED_AUDIO_BYTES = 64 * 1024 // Four seconds at 8 kHz PCM16.

export default class ChatAudioIO extends ChatAudioIOBase {
  createWorker(specifier, instructions, functions, voiceID, providerID, modelID, apiKey) {
    this.audioBackpressureEnabled = false
    this.audioInFlight = false
    this.audioQueue = []
    this.queuedAudioBytes = 0
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
      nativeStack: 8192,
    })
    this.workerHandle = worker
    this.worker = {
      postMessage: (message) => this.postWorkerMessage(message),
      terminate: () => {
        this.workerHandle = null
        this.resetAudioQueue()
        worker.terminate()
      },
    }
    worker.onmessage = (message) => {
      this[message.id](message)
    }
    this.worker.postMessage({
      id: 'configure',
      instructions,
      functions,
      voiceID,
      providerID,
      modelID,
      apiKey,
    })
    this.ensureInput()
  }

  wait() {
    this.onStateChanged(ChatAudioIOBase.WAITING)
  }

  resume() {
    this.onStateChanged(this.state)
  }

  audioBackpressure() {
    this.audioBackpressureEnabled = true
  }

  audioSent() {
    const message = this.audioQueue.shift()
    if (!message) {
      this.audioInFlight = false
      return
    }
    this.queuedAudioBytes -= message.size
    this.workerHandle?.postMessage(message)
  }

  postWorkerMessage(message) {
    const worker = this.workerHandle
    if (!worker) return
    if (!this.audioBackpressureEnabled || message.id !== 'sendAudio') {
      worker.postMessage(message)
      return
    }
    if (!this.audioInFlight) {
      this.audioInFlight = true
      worker.postMessage(message)
      return
    }
    if (this.queuedAudioBytes + message.size > MAX_QUEUED_AUDIO_BYTES) {
      this.resetAudioQueue()
      this.failed({ string: 'audio worker backpressure' })
      return
    }
    const previous = this.audioQueue.at(-1)
    if (previous && previous.offset + previous.size === message.offset) previous.size += message.size
    else this.audioQueue.push(message)
    this.queuedAudioBytes += message.size
  }

  resetAudioQueue() {
    this.audioInFlight = false
    this.audioQueue.length = 0
    this.queuedAudioBytes = 0
  }
}
