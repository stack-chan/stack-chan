import ChatAudioIOBase from 'ChatAudioIOBase'
import Worker from 'worker'

export default class ChatAudioIO extends ChatAudioIOBase {
  createWorker(specifier, instructions, functions, voiceID, providerID, modelID, apiKey) {
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
    })
    let audioInFlight = false
    this.worker = {
      terminate: () => worker.terminate(),
      postMessage: (message) => {
        if (message.id !== 'sendAudio') {
          worker.postMessage(message)
          return
        }
        if (audioInFlight) {
          return
        }
        audioInFlight = true
        worker.postMessage(message)
      },
    }
    worker.onmessage = (message) => {
      if (message.id === 'audioConsumed') {
        audioInFlight = false
        return
      }
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
