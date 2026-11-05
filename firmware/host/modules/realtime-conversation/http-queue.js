// Copyright (c) 2026 Shinya Ishikawa
// SPDX-License-Identifier: Apache-2.0

import { safeHttpCode } from 'realtimeConversation/http-errors'

export function createHttpQueue({ execute, post, schedule, elapsed }) {
  let tail = Promise.resolve(),
    queued = 0
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
    if (queued >= 8) {
      try {
        post({ id, error: true, code: 'https_capacity' })
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
          message = { id, error: true, code: safeHttpCode(error) }
        }
        await reply(message, remaining)
      } finally {
        queued--
      }
    })
    return tail
  }
}
