// Copyright (c) 2026 Shinya Ishikawa
// SPDX-License-Identifier: Apache-2.0

/* One HTTPS connection per request. The SDK's compact fetch keeps global
 * clients and does not reject its body promise on every socket failure.
 * Signaling instead needs a bounded body, a deadline, and deterministic close.
 * Only HTTPS POST is supported; redirects are never followed. */
export default function liveFetch(url, options, platform) {
  const endpoint = /^https:\/\/([a-zA-Z0-9.-]+)(?::([0-9]{1,5}))?(\/[^\s#]*)$/.exec(url)
  if (!endpoint || options.method !== 'POST' || (endpoint[2] && (+endpoint[2] < 1 || +endpoint[2] > 65535)))
    return Promise.reject(new URIError('Invalid Live endpoint'))
  return new Promise((resolve, reject) => {
    let client,
      timer,
      finished = false,
      body,
      buffer,
      offset = 0,
      status
    function finish(error) {
      if (finished) return
      finished = true
      if (timer) platform.clearTimeout(timer)
      try {
        client?.close()
      } catch {}
      client = undefined
      body = undefined
      if (error) {
        buffer = undefined
        reject(error)
      } else {
        const result = buffer ?? new ArrayBuffer()
        buffer = undefined
        resolve({ status, ok: status >= 200 && status < 300, text: async () => platform.decode(result) })
      }
    }
    try {
      body = platform.encode(options.body)
      const headers = new Map(Object.entries(options.headers).map(([name, value]) => [name.toLowerCase(), value]))
      headers.set('content-length', String(body.byteLength))
      headers.set('connection', 'close')
      timer = platform.setTimeout(
        () => finish(new Error('Live HTTPS request timed out')),
        Math.max(1000, Math.min(45000, options.timeoutMs ?? 45000)),
      )
      client = platform.createClient({
        host: endpoint[1],
        port: +(endpoint[2] ?? 443),
        certificate: options.certificate,
        onError() {
          finish(new Error('Live HTTPS connection failed'))
        },
      })
      client.request({
        method: 'POST',
        path: endpoint[3],
        headers,
        onHeaders(code, responseHeaders) {
          status = code
          if (Number(responseHeaders.get('content-length')) > 131072)
            finish(new Error('Live HTTPS response exceeds limit'))
        },
        onWritable(count) {
          if (finished) return
          try {
            count = Math.min(count, body.byteLength - offset)
            if (count) {
              this.write(new DataView(body, offset, count))
              offset += count
            } else this.write()
          } catch {
            finish(new Error('Live HTTPS write failed'))
          }
        },
        onReadable(count) {
          if (finished || !count) return
          try {
            if ((buffer?.byteLength ?? 0) + count > 131072) throw new Error()
            const chunk = this.read(count)
            buffer = buffer ? buffer.concat(chunk) : chunk
          } catch {
            finish(new Error('Live HTTPS response could not be read within limit'))
          }
        },
        onDone(error) {
          finish(error ? new Error('Live HTTPS request failed') : undefined)
        },
      })
    } catch {
      finish(new Error('Live HTTPS initialization failed'))
    }
  })
}
