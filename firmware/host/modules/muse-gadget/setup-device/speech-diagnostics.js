const codes = Object.freeze({ 'turn.started': 1, 'output.text': 2, error: 3, 'turn.ended': 4, 'tts.metrics': 5 })
const numeric = (value) => (Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0)

export function createSpeechDiagnostics({ timer, heap, emit }) {
  let previous = heap.now(),
    maxLag = 0,
    textSeen = false,
    closed = false
  const sampleLag = () => {
    const now = heap.now()
    maxLag = Math.max(maxLag, numeric(now - previous - 100))
    previous = now
  }
  const handle = timer.repeat(() => {
    if (!closed) sampleLag()
  }, 100)
  return {
    event(event) {
      if (closed || !Object.hasOwn(codes, event.type)) return
      if (event.type === 'turn.started') textSeen = false
      if (event.type === 'output.text') {
        if (textSeen) return
        textSeen = true
      }
      // Include a stalled timer's outstanding delay before emitting the event summary.
      maxLag = Math.max(maxLag, numeric(heap.now() - previous - 100))
      const values = [heap.internalFree(), heap.internalMinimum(), heap.internalLargest(), heap.psramFree(), maxLag]
      emit(`MUSE_DIAG ${codes[event.type]} ${values.map(numeric).join(' ')}\n`)
      if (event.type === 'turn.started') maxLag = 0
    },
    close() {
      if (closed) return
      closed = true
      timer.clear(handle)
    },
  }
}
