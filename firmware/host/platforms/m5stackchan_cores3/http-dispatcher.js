// A bounded HTTP dispatcher with a reusable asynchronous backend.
// A timeout or backend error retires the request and its open connection.
export function createBackgroundFetch({ createWorker, schedule, cancel }) {
  const queue = []
  let worker,
    active,
    pumping = false,
    sequence = 0
  function prepare() {
    if (worker) return
    const created = createWorker()
    worker = created
    created.onmessage = (response) => {
      if (worker !== created || !active || response.id !== active.id) return
      if (response.error) {
        const error = new Error(response.error.message)
        // XS freezes built-in prototypes during preload. Shadow Error.name
        // explicitly; assignment to the inherited read-only property throws.
        Object.defineProperty(error, 'name', { value: response.error.name, configurable: true })
        finish(active, error, undefined, true)
      } else finish(active, undefined, response)
    }
  }
  function finish(job, error, response, retire = false) {
    if (job.finished) return
    job.finished = true
    cancel(job.timer)
    if (active === job) {
      active = undefined
      pumping = true
      const oldWorker = retire ? worker : undefined
      if (retire) worker = undefined
      schedule(() => {
        oldWorker?.terminate()
        pumping = false
        pump()
      }, 1)
    } else {
      const index = queue.indexOf(job)
      if (index >= 0) queue.splice(index, 1)
    }
    if (error) job.reject(error)
    else
      job.resolve({
        status: response.status,
        ok: response.status >= 200 && response.status < 300,
        connectionReused: response.connectionReused === true,
        text: async () => response.body,
      })
  }
  function pump() {
    if (active || pumping || !queue.length) return
    const job = queue.shift()
    active = job
    try {
      prepare()
      worker.postMessage({ id: job.id, url: job.url, options: job.options })
    } catch (error) {
      finish(job, error, undefined, true)
    }
  }
  const fetch = (url, options) =>
    new Promise((resolve, reject) => {
      if (queue.length + (active ? 1 : 0) >= 8) {
        reject(new Error('Live HTTPS request capacity'))
        return
      }
      const timeoutMs = Math.max(1000, Math.min(45000, options?.timeoutMs ?? 45000))
      const job = { id: ++sequence, url, options, resolve, reject }
      job.timer = schedule(() => finish(job, new Error('Live HTTPS request timed out'), undefined, true), timeoutMs)
      queue.push(job)
      pump()
    })
  fetch.prepare = prepare
  return fetch
}
