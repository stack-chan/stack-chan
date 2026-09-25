import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { normalizeRequest } from './http-request-options.js'

test('native reuse permits path changes but isolates scheme, host and port', () => {
  const directory = mkdtempSync(join(tmpdir(), 'stackchan-http-origin-'))
  try {
    const executable = join(directory, 'origin-test')
    execFileSync(
      'cc',
      [
        '-std=c11',
        '-Wall',
        '-Werror',
        '-I',
        fileURLToPath(new URL('.', import.meta.url)),
        '-x',
        'c',
        '-',
        '-o',
        executable,
      ],
      {
        input: `#include <assert.h>
#include "http-reuse.h"
int main(void) {
  assert(liveHttpSameOrigin("https://device.test/bootstrap", "https://device.test/session?x=1"));
  assert(liveHttpSameOrigin("https://device.test:8443/a", "https://device.test:8443/b"));
  assert(!liveHttpSameOrigin("https://device.test/a", "https://other.test/a"));
  assert(!liveHttpSameOrigin("https://device.test/a", "https://device.test.evil/a"));
  assert(!liveHttpSameOrigin("https://device.test:8443/a", "https://device.test:8444/a"));
  assert(!liveHttpSameOrigin("https://device.test/a", "https://device.test:443/a"));
  assert(!liveHttpSameOrigin("https://device.test/a", "http://device.test/a"));
  assert(!liveHttpSameOrigin("https://device.test", "https://device.test/a"));
  assert(!liveHttpSameOrigin("https:///a", "https:///b"));
  return 0;
}`,
      },
    )
    execFileSync(executable)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

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
