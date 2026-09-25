// Copyright (c) 2026 Shinya Ishikawa
// SPDX-License-Identifier: Apache-2.0

import request from 'realtimeConversation/httpCore'
import Timer from 'timer'

export default function liveFetch(url, options) {
  return request(url, options, {
    createClient: ({ certificate, ...options }) =>
      new device.network.https.io({
        ...device.network.https,
        ...options,
        socket: {
          ...device.network.https.socket,
          tls: {
            ...device.network.https.socket.tls,
            ...(certificate ? { ca: certificate } : {}),
          },
        },
      }),
    setTimeout: (callback, delay) => Timer.set(callback, delay),
    clearTimeout: (timer) => Timer.clear(timer),
    encode: (text) => ArrayBuffer.fromString(text),
    decode: (buffer) => String.fromArrayBuffer(buffer),
  })
}
