// Copyright (c) 2026 Shinya Ishikawa
// SPDX-License-Identifier: Apache-2.0
// Keep the OpenAI-compatible HTTPS POST contract independent of the backend.
export function normalizeRequest(url, options, encode, decodeCertificate) {
  const endpoint = /^https:\/\/([a-zA-Z0-9.-]+)(?::([0-9]{1,5}))?(\/[^\s#]*)$/.exec(url)
  if (!endpoint || options?.method !== 'POST' || (endpoint[2] && (+endpoint[2] < 1 || +endpoint[2] > 65535)))
    throw new URIError('Invalid Live endpoint')
  const headers = []
  for (const [name, value] of Object.entries(options.headers ?? {})) {
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || /[\r\n\0]/.test(String(value)))
      throw new TypeError('Invalid Live header')
    if (['connection', 'content-length'].includes(name.toLowerCase())) continue
    headers.push([name.toLowerCase(), String(value)])
  }
  const body = encode(String(options.body ?? ''))
  const encodedHeaders = encode(JSON.stringify(headers))
  if (typeof options.certificate === 'string' && options.certificate.length > 16384)
    throw new RangeError('Live HTTPS certificate exceeds limit')
  const certificate =
    typeof options.certificate === 'string' ? decodeCertificate(options.certificate) : options.certificate
  if (
    url.length > 4096 ||
    body.byteLength > 131072 ||
    encodedHeaders.byteLength > 16384 ||
    (certificate && certificate.byteLength > 16384)
  )
    throw new RangeError('Live HTTPS request exceeds limit')
  const requested = Number(options.timeoutMs ?? 45000)
  if (!Number.isFinite(requested)) throw new RangeError('Invalid Live HTTPS deadline')
  return {
    host: endpoint[1],
    port: +(endpoint[2] ?? 443),
    path: endpoint[3],
    headers,
    body,
    certificate,
    timeoutMs: Math.max(1000, Math.min(45000, requested)),
  }
}
