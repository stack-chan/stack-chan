import snapshot from 'memory-diagnostics'
import { MemoryRecorder } from 'memory-recorder'
import { LiveSession as BaseSession } from 'openai-live-session-base'
import Timer from 'timer'

// Selected only by manifest.memory.json. The ordinary MOD remains unchanged.
export class LiveSession extends BaseSession {
  constructor(options) {
    const recorder = new MemoryRecorder({
      snapshot,
      write: (line) => trace(line),
      setTimeout: (callback, delay) => Timer.set(callback, delay),
      clearTimeout: (timer) => Timer.clear(timer),
    })
    super({
      ...options,
      Conversation: class extends options.Conversation {
        connect() {
          const pending = super.connect()
          recorder.onNegotiating()
          return pending
        }
      },
      onState(state) {
        recorder.onState(state)
        options.onState(state)
      },
    })
    recorder.sample('idle-before-use')
  }
}
