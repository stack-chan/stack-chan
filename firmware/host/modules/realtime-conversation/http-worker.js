// Copyright (c) 2026 Shinya Ishikawa
// SPDX-License-Identifier: Apache-2.0
import Timer from 'timer'
import {requestHttps} from 'realtimeConversation/http-core'

const platform = {
  createClient: ({certificate, ...options}) => new device.network.https.client.io({
    ...device.network.https.client, ...options,
    socket: {...device.network.https.client.socket,
      tls: {...device.network.https.client.socket.tls, ...(certificate ? {ca: certificate} : {})}},
  }),
  schedule: (fn, ms) => Timer.set(fn, ms), cancel: timer => Timer.clear(timer),
}
let tail = Promise.resolve(), queued = 0
function reply(message) {
  try { self.postMessage(message) }
  catch { Timer.set(() => reply(message), 25) }
}
self.onmessage = ({id, deadline, request}) => {
  if (queued >= 8) { reply({id, error: 'HTTPS request capacity'}); return }
  queued++
  tail = tail.then(async () => {
    try {
      request.timeoutMs = deadline - Date.now()
      if (request.timeoutMs <= 0) throw new Error('HTTPS request timed out')
      const result = await requestHttps(request, platform)
      reply({id, ...result})
    } catch (error) { reply({id, error: String(error)}) }
    finally { queued-- }
  })
}
