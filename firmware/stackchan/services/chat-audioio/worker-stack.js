import ChatAudioIOBase from 'ChatAudioIOBase'
import Worker from 'worker'

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
      stack: 1024,
      nativeStack: 8192,
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
