// Copyright (c) 2026 Shinya Ishikawa
// SPDX-License-Identifier: Apache-2.0

import { httpFailure, safeHttpCode } from 'realtimeConversation/http-errors'
// The HTTP VM is owned by its caller VM; audio, UI and TLS never share a queue.
export function createHttpProxy({ createWorker, normalize, decode, schedule, cancel, now }) {
  const worker = createWorker()
  let sequence = 0
  const pending = new Map()
  worker.onmessage = (message) => {
    const job = pending.get(message.id)
    if (!job) return
    pending.delete(message.id)
    cancel(job.timer)
    if (message.error) job.reject(httpFailure(safeHttpCode(message)))
    else
      job.resolve({
        status: message.status,
        ok: message.status >= 200 && message.status < 300,
        text: async () => decode(message.body),
      })
  }

  return (url, options) =>
    new Promise((resolve, reject) => {
      if (pending.size >= 8) throw httpFailure('https_capacity')
      const request = normalize(url, options),
        id = ++sequence
      const started = now()
      const job = { resolve, reject }
      job.timer = schedule(() => {
        pending.delete(id)
        reject(httpFailure('https_timeout'))
      }, request.timeoutMs)
      pending.set(id, job)
      try {
        worker.postMessage({ id, started, request })
      } catch {
        pending.delete(id)
        cancel(job.timer)
        reject(httpFailure('https_ipc_failed'))
      }
    })
}
