// Copyright (c) 2026 Shinya Ishikawa
// SPDX-License-Identifier: Apache-2.0
// The HTTP VM is owned by its caller VM; audio, UI and TLS never share a queue.
export function createHttpProxy({ createWorker, releaseWorker, normalize, decode, schedule, cancel, now }) {
  let worker, lastPosted
  let sequence = 0
  const pending = new Map()
  function release(created) {
    worker = undefined
    lastPosted = undefined
    releaseWorker(created)
  }
  function getWorker() {
    if (worker) return worker
    const created = createWorker()
    created.onmessage = (message) => {
      if (worker !== created) return
      // Caller deadlines do not prove that TLS/socket cleanup has completed.
      // Only the Worker's idle acknowledgement may release an active VM. An
      // older acknowledgement cannot retire a Worker with newly posted work.
      if (message.idle !== undefined) {
        if (releaseWorker && !pending.size && message.idle === lastPosted) release(created)
        return
      }
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
      try {
        job.timer = schedule(() => {
          pending.delete(id)
          reject(new Error('HTTPS request timed out'))
        }, request.timeoutMs)
        pending.set(id, job)
        activeWorker.postMessage({ id, started, request })
        lastPosted = id
      } catch (error) {
        pending.delete(id)
        if (job.timer !== undefined) cancel(job.timer)
        // No message was accepted by a newly allocated Worker. A reused Worker
        // may still be processing requests whose caller deadline has elapsed.
        if (releaseWorker && lastPosted === undefined) release(activeWorker)
        reject(error)
      }
    })
}
