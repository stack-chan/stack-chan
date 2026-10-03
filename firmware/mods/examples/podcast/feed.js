import Timer from 'timer'
import Worker from 'worker'

/** Keep TLS, input buffering and the XML tree outside the UI machine. */
export function loadFeed(url, WorkerType = Worker) {
  let worker, timer, finish
  let settled = false
  const promise = new Promise((resolve, reject) => {
    finish = (error, result) => {
      if (settled) return
      settled = true
      if (timer !== undefined) Timer.clear(timer)
      worker?.terminate()
      worker = undefined
      if (error) reject(error)
      else resolve(result)
    }
    try {
      worker = new WorkerType('podcast-feed-worker', {
        static: 2 * 1024 * 1024,
        chunk: { initial: 512 * 1024, incremental: 64 * 1024 },
        heap: { initial: 8192, incremental: 1024 },
        stack: 1024,
        nativeStack: 12 * 1024,
        core: 1,
        priority: 1,
      })
      worker.onmessage = (message) => {
        if (message.error) finish(new Error(message.error))
        else finish(undefined, message.result)
      }
      timer = Timer.set(() => finish(new Error('RSS worker timed out')), 35_000)
      worker.postMessage({ url })
    } catch (error) {
      finish(error)
    }
  })
  return {
    promise,
    cancel() {
      finish(new Error('RSS request cancelled'))
    },
  }
}
