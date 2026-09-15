import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeRequest } from './http-request-options.js'

const encode = (text) => new TextEncoder().encode(text).buffer
const decode = (bytes) => new TextDecoder().decode(bytes)

test('POST encoding preserves credentials and UTF-8 while deriving transport headers', () => {
  const [url, body, headers, certificate, timeout] = normalizeRequest(
    'https://example.test:8443/tool?a=1',
    {
      method: 'POST',
      body: '質問。',
      headers: { Authorization: 'Bearer test', 'Content-Length': '999', Connection: 'keep-alive' },
      certificate: 'test certificate',
      timeoutMs: 15000,
    },
    encode,
  )
  assert.equal(url, 'https://example.test:8443/tool?a=1')
  assert.equal(decode(body), '質問。')
  assert.equal(decode(headers), 'Authorization\0Bearer test\0')
  assert.equal(decode(certificate), 'test certificate')
  assert.equal(timeout, 15000)
})
test('only explicit HTTPS POST endpoints are accepted', () => {
  for (const url of [
    'http://example.test/',
    'https://user:password@example.test/',
    'https://example.test:0/',
    'https://example.test:65536/',
    'https://example.test/#fragment',
  ])
    assert.throws(() => normalizeRequest(url, { method: 'POST' }, encode), URIError)
  assert.throws(() => normalizeRequest('https://example.test/', { method: 'GET' }, encode), URIError)
  assert.throws(() => normalizeRequest('https://example.test/', { method: 'POST', timeoutMs: NaN }, encode), RangeError)
})
test('connection reuse is opt-in', () => {
  for (const keepAlive of [undefined, false, true, 'true'])
    assert.equal(
      normalizeRequest('https://example.test/', { method: 'POST', keepAlive }, encode)[5],
      keepAlive === true,
    )
})
test('native header framing and byte bounds reject malformed or oversized requests', () => {
  for (const headers of [{ 'bad:name': 'x' }, { x: 'a\r\nb: c' }, { x: 'a\0b' }])
    assert.throws(() => normalizeRequest('https://example.test/', { method: 'POST', headers }, encode), TypeError)
  assert.throws(
    () => normalizeRequest('https://example.test/', { method: 'POST', body: '日'.repeat(50000) }, encode),
    RangeError,
  )
  const certificate = encode('certificate')
  assert.equal(normalizeRequest('https://example.test/', { method: 'POST', certificate }, encode)[3], certificate)
})
