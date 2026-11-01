export const MAX_SOURCE_BYTES = 32768
export const MAX_BYTECODE_BYTES = 16384
export function checkSource(source) {
  if (typeof source !== 'string') throw new Error('DSL source must be a string')
  if (new TextEncoder().encode(source).length > MAX_SOURCE_BYTES) throw new Error('DSL exceeds 32 KiB')
  return source
}

// In-memory history keeps agent changes reversible, including after human edits.
export function createEditorModel(initial) {
  let source = checkSource(initial),
    revision = 0
  const history = []
  return {
    get source() {
      return source
    },
    get revision() {
      return revision
    },
    get canUndo() {
      return history.length > 0
    },
    replace(next, expectedRevision = revision) {
      checkSource(next)
      if (expectedRevision !== revision) throw new Error('Editor changed; read current revision before replacing')
      if (next === source) return revision
      history.push(source)
      if (history.length > 20) history.shift()
      source = next
      return ++revision
    },
    undo() {
      if (!history.length) return false
      source = history.pop()
      ++revision
      return true
    },
  }
}

// Each request has its own worker: a timeout or superseding edit can terminate
// even a pathological compiler parse, without blocking the UI or stale results.
export function createPreviewService(makeWorker, timeoutMs = 4000) {
  let current
  const cancel = () => {
    current?.cancel()
    current = undefined
  }
  return {
    cancel,
    run(source, context) {
      checkSource(source)
      cancel()
      return new Promise((resolve, reject) => {
        const worker = makeWorker()
        let done = false
        const finish = (error, result) => {
          if (done) return
          done = true
          clearTimeout(timer)
          worker.terminate()
          current = undefined
          error ? reject(error) : resolve(result)
        }
        const timer = setTimeout(() => finish(new Error('Preview timed out; simplify the DSL')), timeoutMs)
        current = { cancel: () => finish(new Error('Preview cancelled')) }
        worker.onmessage = ({ data }) => (data.error ? finish(new Error(data.error)) : finish(null, data))
        worker.onerror = (event) => finish(new Error(event.message || 'Preview worker failed'))
        worker.postMessage({ source, context })
      })
    },
  }
}
