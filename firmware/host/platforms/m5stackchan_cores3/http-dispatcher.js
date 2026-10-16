// A bounded queue over one native HTTPS request. Deadlines include queue time.
export function createBackgroundFetch({ createRequest, normalize, decode, schedule, cancel }) {
  const queue = []
  const errors = ['', 'request timed out', 'response exceeds limit', 'allocation failed', 'connection failed']
  let request, active, idleTimer
  function closeRequest() {
    cancel(idleTimer)
    idleTimer = undefined
    request?.close()
    request = undefined
  }
  function finish(job, error, response) {
    if (job.finished) return
    job.finished = true
    cancel(job.timer)
    cancel(job.poll)
    if (active === job) {
      active = undefined
      if (error) closeRequest()
      else if (job.options.keepAlive === true) idleTimer = schedule(closeRequest, 3000)
      schedule(pump, 1)
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
        text: async () => decode(response.body),
      })
  }
  function poll(job) {
    if (active !== job || job.finished) return
    try {
      request ??= createRequest()
      if (!job.started) job.started = request.start(...job.args)
      const response = job.started && request.read()
      if (response) {
        if (response.errorCode)
          throw new Error(
            `Live HTTPS ${errors[response.errorCode] ?? errors[4]} (native ${response.errorCode}, transport ${response.transportError}, HTTP ${response.status})`,
          )
        finish(job, undefined, response)
      } else job.poll = schedule(() => poll(job), 25)
    } catch (error) {
      finish(job, error)
    }
  }
  function pump() {
    if (active || !queue.length) return
    cancel(idleTimer)
    idleTimer = undefined
    active = queue.shift()
    poll(active)
  }
  return (url, options) =>
    new Promise((resolve, reject) => {
      if (queue.length + (active ? 1 : 0) >= 8) throw new Error('Live HTTPS request capacity')
      const args = normalize(url, options)
      const job = { args, options, resolve, reject }
      job.timer = schedule(() => finish(job, new Error('Live HTTPS request timed out')), args[4])
      queue.push(job)
      pump()
    })
}
