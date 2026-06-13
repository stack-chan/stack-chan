import ChatAudioIOBase from 'ChatAudioIOBase'
import Worker from 'worker'

const CHAT_AUDIOIO_WORKER_STACK = 1024
const CHAT_AUDIOIO_WORKER_NATIVE_STACK = 8192

export default class ChatAudioIO extends ChatAudioIOBase {
  createWorker(specifier, instructions, functions, voiceID, providerID, modelID, apiKey) {
    this.worker = new Worker(specifier, {
      static: 512 * 1024,
      chunk: {
        initial: 64 * 1024,
        incremental: 8 * 1024,
      },
      heap: {
        initial: 1024,
        incremental: 256,
      },
      stack: CHAT_AUDIOIO_WORKER_STACK,
      nativeStack: CHAT_AUDIOIO_WORKER_NATIVE_STACK,
    })
    this.worker.onmessage = (message) => {
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
}
