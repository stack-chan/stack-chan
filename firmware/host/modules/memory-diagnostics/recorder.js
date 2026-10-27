// Pure lifecycle recorder; platform dependencies are supplied by runtime.js.
// Retains no samples and uses at most one one-shot timer, never a poller.
export function createMemoryRecorder({ snapshot, write, schedule, cancel, runId }) {
  let sequence = 0,
    cycle = 0,
    state = 'idle',
    pending,
    generation = 0

  function checkpoint(phase) {
    const record = { schema: 1, runId, sequence: ++sequence, cycle, state, phase }
    try {
      // Take the native snapshot before JSON serialization or output allocation.
      record.heap = snapshot()
      record.status = 'sample'
    } catch {
      record.status = 'unavailable'
    }
    try {
      write(`[memory] ${JSON.stringify(record)}\n`)
    } catch {
      // A diagnostic failure must never break connection or resource cleanup.
    }
  }

  function clear() {
    generation++
    if (pending !== undefined) cancel(pending)
    pending = undefined
  }

  function later(phase, delay) {
    const expected = generation
    pending = schedule(() => {
      if (expected !== generation) return
      pending = undefined
      checkpoint(phase)
    }, delay)
  }

  return {
    checkpoint,
    observe(next) {
      clear()
      state = next
      if (next === 'connecting') {
        cycle++
        checkpoint('before-connect')
        later('connecting-1s', 1000)
      } else if (next === 'connected') {
        checkpoint('connected')
        later('connected-5s', 5000)
      } else if (next === 'closing') {
        checkpoint('before-close')
      } else if (next === 'idle') {
        checkpoint('closed')
        later('closed-5s', 5000)
      } else {
        checkpoint(next === 'configuration' ? 'configuration' : 'error')
      }
    },
    dispose: clear,
  }
}

// This adapter is selected only by the diagnostic MOD manifest.
export function measuredSession(Base, recorder) {
  return class extends Base {
    constructor(options) {
      super({
        ...options,
        onState(state) {
          try {
            recorder.observe(state)
          } catch {
            // Timer/snapshot failure must not suppress the real state callback.
          }
          options.onState?.(state)
        },
      })
    }
  }
}
