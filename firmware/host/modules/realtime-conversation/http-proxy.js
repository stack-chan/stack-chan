// Copyright (c) 2026 Shinya Ishikawa
// SPDX-License-Identifier: Apache-2.0
// The HTTP VM is owned by its caller VM; audio, UI and TLS never share a queue.
export function createHttpProxy({ createWorker, normalize, decode, schedule, cancel, now }) {
  let worker
  let sequence = 0
  const pending = new Map()
  function getWorker() {
    if (worker) return worker
    const created = createWorker()
    created.onmessage = (message) => {
      const job = pending.get(message.id)
      if (!job) return
      pending.delete(message.id)
      cancel(job.timer)
      if (message.error) job.reject(new Error(message.error))
      else
        job.resolve({
          status: message.status,
          ok: message.status >= 200 && message.status < 300,
          text: async () => decode(message.body),
        })
    }
    worker = created
    return worker
  }

  return (url, options) =>
    new Promise((resolve, reject) => {
      if (pending.size >= 8) throw new Error('HTTPS request capacity')
      const request = normalize(url, options),
        id = ++sequence
      const activeWorker = getWorker()
      const started = now()
      const job = { resolve, reject }
      job.timer = schedule(() => {
        pending.delete(id)
        reject(new Error('HTTPS request timed out'))
      }, request.timeoutMs)
      pending.set(id, job)
      try {
        activeWorker.postMessage({ id, started, request })
      } catch (error) {
        pending.delete(id)
        cancel(job.timer)
        reject(error)
      }
    })
}
