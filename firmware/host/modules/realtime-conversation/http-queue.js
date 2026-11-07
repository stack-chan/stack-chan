// Copyright (c) 2026 Shinya Ishikawa
// SPDX-License-Identifier: Apache-2.0

export function createHttpQueue({ execute, post, schedule, elapsed, onIdle }) {
  let tail = Promise.resolve(),
    queued = 0,
    lastReceived,
    lastNotified
  function notifyIdle(id) {
    return Promise.resolve()
      .then(() => {
        if (queued || id !== lastReceived || id === lastNotified) return
        // The caller may terminate this VM as soon as this message arrives.
        // Send outside the queue's async finally and any JS try/catch so XS
        // has already released their native exception frames before teardown.
        onIdle(id)
        lastNotified = id
      })
      .catch(() => {
        // IPC pressure must not strand an otherwise idle Worker indefinitely.
        // The Timer only registers a reaction: its callback must return before
        // another acknowledgement can trigger external Worker termination.
        try {
          schedule(() => notifyIdle(id), 25)
        } catch {}
      })
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
    let idleID
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
        if (!queued) idleID = lastReceived
      }
    })
    // Notification failures are handled on a separate chain so they cannot
    // poison the processing tail or keep later HTTPS requests from starting.
    return onIdle ? tail.then(() => (idleID === undefined ? undefined : notifyIdle(idleID))) : tail
  }
}
