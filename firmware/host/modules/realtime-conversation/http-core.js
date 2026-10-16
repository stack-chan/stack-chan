// Copyright (c) 2026 Shinya Ishikawa
// SPDX-License-Identifier: Apache-2.0
// Standard ECMA-419 HTTP callbacks, bounded response and deterministic close.
export function requestHttps(request, platform) {
  return new Promise((resolve, reject) => {
    let client,
      timer,
      buffer,
      offset = 0,
      status,
      finished = false
    let body = request.body
    function finish(error) {
      if (finished) return
      finished = true
      if (timer !== undefined) platform.cancel(timer)
      const connection = client
      client = undefined
      body = undefined
      // Leave the SDK callback before closing its current TLS/socket state.
      platform.schedule(() => {
        try {
          connection?.close()
        } catch {}
        if (error) {
          buffer = undefined
          reject(error)
        } else resolve({ status, body: buffer ?? new ArrayBuffer() })
      }, 0)
    }
    try {
      const headers = new Map(request.headers)
      headers.set('content-length', String(body.byteLength))
      headers.set('connection', 'close')
      timer = platform.schedule(() => finish(new Error('HTTPS request timed out')), request.timeoutMs)
      client = platform.createClient({
        host: request.host,
        port: request.port,
        certificate: request.certificate,
        onError() {
          finish(new Error('HTTPS connection failed'))
        },
      })
      client.request({
        method: 'POST',
        path: request.path,
        headers,
        onHeaders(code, responseHeaders) {
          if (finished) return
          status = code
          if (Number(responseHeaders.get('content-length')) > 131072) finish(new Error('HTTPS response exceeds limit'))
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
            finish(new Error('HTTPS write failed'))
          }
        },
        onReadable(count) {
          if (finished || !count) return
          try {
            if ((buffer?.byteLength ?? 0) + count > 131072) throw new Error()
            const chunk = this.read(count)
            buffer = buffer ? buffer.concat(chunk) : chunk
          } catch {
            finish(new Error('HTTPS response exceeds limit or read failed'))
          }
        },
        onDone(error) {
          finish(error || !Number.isInteger(status) ? new Error('HTTPS request failed') : undefined)
        },
      })
    } catch (error) {
      finish(error)
    }
  })
}
