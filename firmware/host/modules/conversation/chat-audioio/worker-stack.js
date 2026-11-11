import ChatAudioIOBase from 'ChatAudioIO'
import { createBorrowedChatIO } from 'stackchanBorrowedChatIO'
import { writePcmRing } from 'stackchanPcmRingWriter'
import Worker from 'worker'

function level(bytes) {
  return native('xs_computeLevel').call(null, bytes)
}

export default class ChatAudioIO {
  static FAILED = ChatAudioIOBase.FAILED
  static DISCONNECTED = ChatAudioIOBase.DISCONNECTED
  static DISCONNECTING = ChatAudioIOBase.DISCONNECTING
  static CONNECTING = ChatAudioIOBase.CONNECTING
  static CONNECTED = Reflect.get(ChatAudioIOBase, 'CONNECTED')
  static SPEAKING = ChatAudioIOBase.SPEAKING
  static LISTENING = ChatAudioIOBase.LISTENING
  static WAITING = ChatAudioIOBase.WAITING
  constructor(options) {
    if (!options.media) throw new Error('Chat worker requires an audio lease')
    createBorrowedChatIO(this, options, ChatAudioIOBase, level)
    try {
      startWorker(this, options)
    } catch (error) {
      this.close()
      throw error
    }
  }
}

function startWorker(io, { specifier, configuration, instructions, functions, voiceID, providerID, modelID, apiKey }) {
  const usesNativePcmRing = specifier === 'xiaozhiV1'

  const worker = new Worker('stackchanVoiceChatWorker', {
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
  io.worker = {
    terminate: () => worker.terminate(),
    postMessage: (message) => worker.postMessage(message),
  }
  // The capture callback and the native Opus encoder share this ring.
  const PCM_RING_BYTES = io.nativeInputBytes
  const PCM_RING_STATE_BYTES = 4 * 4
  const pcmRing = usesNativePcmRing ? new SharedArrayBuffer(PCM_RING_BYTES) : undefined
  const pcmRingState = usesNativePcmRing ? new SharedArrayBuffer(PCM_RING_STATE_BYTES) : undefined
  if (usesNativePcmRing)
    io.writeNativeInput = (bytes) => {
      if (writePcmRing(pcmRing, pcmRingState, bytes.buffer, bytes.byteOffset, bytes.byteLength, 1) !== bytes.byteLength)
        throw new Error('Chat input overrun')
    }

  worker.onmessage = (message) => {
    if (io.voiceClosed) return
    if (message.id === 'audioConsumed') {
      io.releaseInputSlot?.(message.slot)
      return
    }
    const handler = workerEvents.has(message.id) ? io[message.id] : undefined
    if (typeof handler === 'function') {
      handler.call(io, message)
      return
    }
    trace(`[chat] ignored worker message: ${String(message.id)}\n`)
  }
  io.worker.postMessage({
    id: 'configure',
    workerSpecifier: specifier,
    inputRate: io.inputSampleRate,
    outputRate: io.outputSampleRate,
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
  io.ensureInput()
}

const workerEvents = new Set([
  'configureAudio',
  'connected',
  'disconnected',
  'failed',
  'speak',
  'listen',
  'receiveAudio',
  'receiveFunctionCall',
  'receiveInputText',
  'receiveOutputText',
  'receiveEmotion',
  'receiveAlert',
  'receiveSystemCommand',
  'receiveCustomEvent',
  'receiveUnknownEvent',
  'protocolWarning',
  'receiveMcpNotification',
  'receiveMcpResponse',
  'receiveGlyphPush',
])
