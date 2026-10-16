// Copyright (c) 2026 Shinya Ishikawa
// SPDX-License-Identifier: Apache-2.0
import Timer from 'timer'
import tlsCache from 'ssl/cache'
import { requestHttps } from 'realtimeConversation/http-core'

const platform = {
  createClient: ({ certificate, ...options }) =>
    new device.network.https.client.io({
      ...device.network.https.client,
      ...options,
      socket: {
        ...device.network.https.client.socket,
        tls: { ...device.network.https.client.socket.tls, ...(certificate ? { ca: certificate } : {}) },
      },
    }),
  schedule: (fn, ms) => Timer.set(fn, ms),
  cancel: (timer) => Timer.clear(timer),
}
let tail = Promise.resolve(),
  queued = 0
function reply(message) {
  return new Promise((resolve) => {
    const send = () => {
      try {
        self.postMessage(message)
        resolve()
      } catch {
        Timer.set(send, 25)
      }
    }
    send()
  })
}
self.onmessage = ({ id, deadline, request }) => {
  if (queued >= 8) {
    // The caller's deadline also bounds an undeliverable capacity rejection.
    try {
      self.postMessage({ id, error: 'HTTPS request capacity' })
    } catch {}
    return
  }
  queued++
  tail = tail.then(async () => {
    try {
      request.timeoutMs = deadline - Date.now()
      if (request.timeoutMs <= 0) throw new Error('HTTPS request timed out')
      // The SDK session cache keys only by host, without the trust anchor.
      if (request.certificate) tlsCache.deleteSessionID()
      const result = await requestHttps(request, platform)
      await reply({ id, ...result })
    } catch (error) {
      await reply({ id, error: String(error) })
    } finally {
      if (request.certificate) tlsCache.deleteSessionID()
      queued--
    }
  })
}
