// Copyright (c) 2026 Shinya Ishikawa
// SPDX-License-Identifier: Apache-2.0

import { createClosingClient, guardSocketCallbacks, requestHttps } from 'realtimeConversation/http-core'
import { createHttpQueue } from 'realtimeConversation/http-queue'
import tlsCache from 'ssl/cache'
import Time from 'time'
import Timer from 'timer'

const CheckedTCP = guardSocketCallbacks(device.network.https.client.socket.TCP.io)
const platform = {
  createClient: ({ certificate, ...options }) =>
    createClosingClient(device.network.https.client.io, {
      ...device.network.https.client,
      ...options,
      socket: {
        ...device.network.https.client.socket,
        TCP: { ...device.network.https.client.socket.TCP, io: CheckedTCP },
        tls: { ...device.network.https.client.socket.tls, ...(certificate ? { ca: certificate } : {}) },
      },
    }),
  schedule: (fn, ms) => Timer.set(fn, ms),
  cancel: (timer) => Timer.clear(timer),
}
self.onmessage = createHttpQueue({
  post: (message) => self.postMessage(message),
  schedule: platform.schedule,
  elapsed: (started) => Time.delta(started, Time.ticks),
  async execute(request) {
    // The SDK session cache keys only by host, without the trust anchor.
    if (request.certificate) tlsCache.deleteSessionID()
    try {
      return await requestHttps(request, platform)
    } finally {
      if (request.certificate) tlsCache.deleteSessionID()
    }
  },
})
