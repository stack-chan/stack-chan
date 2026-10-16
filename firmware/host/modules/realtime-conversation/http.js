// Copyright (c) 2026 Shinya Ishikawa
// SPDX-License-Identifier: Apache-2.0

import { normalizeRequest } from 'realtimeConversation/http-options'
import { createHttpProxy } from 'realtimeConversation/http-proxy'
import Base64 from 'base64'
import Timer from 'timer'
import Worker from 'worker'

export default createHttpProxy({
  createWorker: () =>
    new Worker('realtimeConversation/http-worker', {
      static: 512 * 1024,
      heap: { initial: 8192, incremental: 1024 },
      chunk: { initial: 256 * 1024, incremental: 16384 },
      stack: 1024,
      nativeStack: 6144,
      priority: 3,
    }),
  normalize: (url, options) =>
    normalizeRequest(
      url,
      options,
      (text) => ArrayBuffer.fromString(text),
      (pem) => {
        const match = /^-----BEGIN CERTIFICATE-----\s*([A-Za-z0-9+/=\s]+)-----END CERTIFICATE-----\s*$/.exec(pem)
        if (!match) throw new TypeError('Invalid HTTPS certificate')
        return Base64.decode(match[1].replace(/\s/g, ''))
      },
    ),
  decode: (body) => String.fromArrayBuffer(body),
  schedule: (fn, ms) => Timer.set(fn, ms),
  cancel: (timer) => Timer.clear(timer),
  now: Date.now,
})
