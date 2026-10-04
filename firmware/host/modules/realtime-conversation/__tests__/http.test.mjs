// Copyright (c) 2026 Shinya Ishikawa
// SPDX-License-Identifier: Apache-2.0

/*---
description: Bounded Live signaling HTTP connections close on every terminal path
flags: [module]
---*/
import request from '../httpCore.js'

function check(v) {
  if (!v) throw new Error('assertion failed')
}
function setup(url = 'https://api.openai.com/v1/live/sessions', options = {}) {
  let callbacks,
    clientCallbacks,
    timeout,
    closes = 0,
    clears = 0
  const client = {
    request(options) {
      callbacks = options
    },
    close() {
      closes++
    },
  }
  const platform = {
    createClient(options) {
      clientCallbacks = options
      return client
    },
    setTimeout(cb, delay) {
      check(delay === (options.timeoutMs ?? 45000))
      timeout = cb
      return 1
    },
    clearTimeout() {
      clears++
    },
    encode(text) {
      return Uint8Array.from(Array.from(text, (c) => c.charCodeAt(0))).buffer
    },
    decode(buffer) {
      return String.fromCharCode(...new Uint8Array(buffer))
    },
  }
  const promise = request(
    url,
    { method: 'POST', headers: { Authorization: 'Bearer test' }, body: '{}', ...options },
    platform,
  )
  return {
    promise,
    get connection() {
      return clientCallbacks
    },
    get cb() {
      return callbacks
    },
    get closes() {
      return closes
    },
    get clears() {
      return clears
    },
    timeout() {
      timeout()
    },
    error() {
      clientCallbacks.onError()
    },
  }
}
async function fails(h) {
  let error
  try {
    await h.promise
  } catch (e) {
    error = e
  }
  check(error instanceof Error)
  check(h.closes === 1 && h.clears === 1)
}
{
  const h = setup()
  const pieces = []
  const ctx = {
    write(view) {
      if (view) pieces.push(...new Uint8Array(view.buffer, view.byteOffset, view.byteLength))
    },
    read(_count) {
      return Uint8Array.from([79, 75]).buffer
    },
  }
  h.cb.onWritable.call(ctx, 1)
  h.cb.onWritable.call(ctx, 20)
  h.cb.onWritable.call(ctx, 20)
  check(String.fromCharCode(...pieces) === '{}')
  h.cb.onHeaders(201, new Map())
  h.cb.onReadable.call(ctx, 2)
  h.cb.onDone()
  const response = await h.promise
  check(response.status === 201 && (await response.text()) === 'OK')
  h.error()
  h.cb.onDone()
  check(h.closes === 1 && h.clears === 1)
}
{
  const h = setup()
  h.error()
  await fails(h)
}
{
  const h = setup()
  h.timeout()
  await fails(h)
}
{
  const h = setup()
  h.cb.onHeaders(201, new Map([['content-length', '131073']]))
  await fails(h)
}
{
  const h = setup()
  let reads = 0
  const ctx = {
    read(n) {
      reads++
      return {
        byteLength: n,
        concat(next) {
          return { byteLength: this.byteLength + next.byteLength, concat: this.concat }
        },
      }
    },
  }
  h.cb.onHeaders(201, new Map())
  h.cb.onReadable.call(ctx, 65536)
  h.cb.onReadable.call(ctx, 65536)
  check(reads === 2)
  h.cb.onReadable.call(ctx, 1)
  check(reads === 2)
  await fails(h)
}
{
  const h = setup()
  h.cb.onDone(new Error('socket'))
  await fails(h)
}
{
  const certificate = new ArrayBuffer(8)
  const h = setup('https://broker.example:8443/token', { certificate })
  check(h.connection.host === 'broker.example' && h.connection.port === 8443)
  check(h.connection.certificate === certificate && h.cb.path === '/token')
  h.cb.onHeaders(302, new Map([['location', 'https://attacker.example/']]))
  h.cb.onDone()
  check((await h.promise).status === 302 && h.closes === 1)
}
for (const url of [
  'http://broker.example/token',
  'https://user:password@broker.example/token',
  'https://broker.example:0/token',
  'https://broker.example:65536/token',
  'https://broker.example/token#fragment',
]) {
  let rejected = false
  try {
    await request(url, { method: 'POST' }, {})
  } catch (error) {
    rejected = error instanceof URIError
  }
  check(rejected)
}
{
  const h = setup('https://broker.example/history', { timeoutMs: 5000 })
  h.timeout()
  await fails(h)
}
console.log('9 HTTP cleanup/routing tests passed')
