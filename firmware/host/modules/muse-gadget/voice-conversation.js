const pcm = Object.freeze({ encoding: 'pcm_s16le', sampleRate: 16000, channels: 1 })

function failure(code, message) {
  return Object.assign(new Error(message), { code })
}

export function createMuseConversation(bridge) {
  return {
    capabilities: Object.freeze({
      interruption: 'local-only',
      historyRepair: 'restart',
      textInput: false,
      imageInput: false,
      inputRoles: [],
      interruptionReuse: 'restart-required',
      turnControl: 'provider',
      submitCompletion: 'unavailable',
    }),
    audio: { input: [pcm], output: [pcm], duplex: 'half' },
    async open({ media, signal, history, onEvent }) {
      if (signal.aborted) throw failure('cancelled', 'Muse call was cancelled')
      if (history.length) throw failure('unsupported_capability', 'Muse voice cannot restore client history')
      let call
      let closing = false
      let terminated = false
      let closeTask
      const emit = (event) => {
        if (!closing) onEvent(event)
      }
      const receive = (event) => {
        if (event.type === 'session.ended') {
          if (terminated) return
          terminated = true
          onEvent(event)
          return
        }
        if (terminated || closing || signal.aborted) return
        if (event.type === 'turn.settled') emit({ type: 'turn.ended', turnId: event.turnId, status: 'completed' })
        else emit(event)
      }
      const close = (options) => {
        if (closeTask) return closeTask
        closing = true
        signal.removeEventListener('abort', abort)
        closeTask = Promise.resolve().then(async () => {
          const result = await call.close(options)
          return result
        })
        return closeTask
      }
      const abort = () => {
        if (call) void close({ mode: 'abort' }).catch(() => {})
      }
      signal.addEventListener('abort', abort)
      try {
        call = await bridge.open({ media, signal, onEvent: receive })
        if (signal.aborted) {
          await close({ mode: 'abort' })
          throw failure('cancelled', 'Muse call was cancelled during connection')
        }
      } catch (error) {
        signal.removeEventListener('abort', abort)
        closing = true
        throw error
      }
      const active = () => {
        if (terminated || closing || signal.aborted) throw failure('cancelled', 'Muse call is closed')
      }
      return {
        id: call.id,
        async submit() {
          throw failure('unsupported_capability', 'Muse voice accepts microphone input only')
        },
        async setInputEnabled(enabled) {
          active()
          await call.setInputEnabled(enabled)
        },
        async interrupt() {
          active()
          const playback = await call.interrupt()
          return { playback, remote: 'continued', history: 'restart-required' }
        },
        close,
      }
    },
  }
}
