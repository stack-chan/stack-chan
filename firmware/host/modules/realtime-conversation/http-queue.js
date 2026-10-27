// Copyright (c) 2026 Shinya Ishikawa
// SPDX-License-Identifier: Apache-2.0

export function createHttpQueue({ execute, post, schedule, elapsed, onIdle }) {
  let tail = Promise.resolve(),
    queued = 0,
    lastReceived
  function notifyIdle(id) {
    if (!onIdle || queued || id !== lastReceived) return
    try {
      onIdle(id)
    } catch {
      // IPC pressure must not strand an otherwise idle Worker indefinitely.
      // A new request invalidates this notification and its retry.
      try {
        schedule(() => notifyIdle(id), 25)
      } catch {}
    }
  }
  function reply(message, remaining) {
    return new Promise((resolve) => {
      const send = () => {
        const left = remaining()
        if (left <= 0) return resolve()
        try {
          post(message)
          resolve()
        } catch {
          try {
            schedule(send, Math.min(25, left))
          } catch {
            resolve()
          }
        }
      }
      send()
    })
  }
  return ({ id, started, request }) => {
    lastReceived = id
    if (queued >= 8) {
      try {
        post({ id, error: 'HTTPS request capacity' })
      } catch {}
      return
    }
    queued++
    const remaining = () => request.timeoutMs - elapsed(started)
    tail = tail.then(async () => {
      try {
        const timeoutMs = remaining()
        if (timeoutMs <= 0) return
        let message
        try {
          message = { id, ...(await execute({ ...request, timeoutMs })) }
        } catch (error) {
          message = { id, error: String(error) }
        }
        await reply(message, remaining)
      } finally {
        queued--
        if (!queued) notifyIdle(lastReceived)
      }
    })
    return tail
  }
}
