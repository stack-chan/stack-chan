import assert from 'node:assert/strict'
import test from 'node:test'
import { createClosingClient, guardSocketCallbacks, requestHttps } from '../http-core.js'
import { normalizeRequest } from '../http-options.js'
import { createHttpProxy } from '../http-proxy.js'

const encode = (text) => new TextEncoder().encode(text).buffer
const decode = (buffer) => new TextDecoder().decode(buffer)
const normalize = (url, options) => normalizeRequest(url, options, encode, (pem) => encode(pem))
const post = (options = {}) => normalize('https://service.test:8443/path?x=1', { method: 'POST', ...options })

test('HTTPS request bounds and header validation happen before IPC', () => {
  for (const url of [
    'http://host/a',
    'https://u:p@host/a',
    'https://host:0/a',
    'https://host:65536/a',
    'https://host/a#b',
  ])
    assert.throws(() => normalize(url, { method: 'POST' }), URIError)
  for (const headers of [{ 'bad:name': 'x' }, { x: 'bad\r\n' }, { x: 'bad\0' }])
    assert.throws(() => post({ headers }), TypeError)
  for (const options of [{ body: '日'.repeat(50000) }, { certificate: new ArrayBuffer(16385) }, { timeoutMs: NaN }])
    assert.throws(() => post(options), RangeError)
  const request = post({ body: '質問', headers: { Authorization: 'Bearer test', Connection: 'keep-alive' } })
  assert.equal(decode(request.body), '質問')
  assert.equal(request.port, 8443)
  assert.equal(request.path, '/path?x=1')
  assert.deepEqual(request.headers, [['authorization', 'Bearer test']])
})
function fixture() {
  let callbacks,
    connection,
    expired,
    closes = 0,
    cancels = 0
  const context = {
    write() {},
    read(view) {
      return view.byteLength
    },
  }
  const platform = {
    createClient(options) {
      connection = options
      return {
        request(options) {
          callbacks = options
        },
        close() {
          closes++
        },
      }
    },
    schedule(fn, ms) {
      if (ms === 0) {
        queueMicrotask(fn)
        return -1
      }
      expired = fn
      return 0
    },
    cancel() {
      cancels++
    },
  }
  const promise = requestHttps(post({ body: 'abc' }), platform)
  return {
    promise,
    context,
    get cb() {
      return callbacks
    },
    get connection() {
      return connection
    },
    get closes() {
      return closes
    },
    get cancels() {
      return cancels
    },
    expire() {
      expired()
    },
  }
}
test('partial writes preserve the body and HTTP error statuses never trigger retries', async () => {
  const f = fixture(),
    pieces = []
  f.context.write = (view) => {
    if (view) pieces.push(...new Uint8Array(view.buffer, view.byteOffset, view.byteLength))
  }
  f.cb.onWritable.call(f.context, 1)
  f.cb.onWritable.call(f.context, 9)
  f.cb.onWritable.call(f.context, 9)
  assert.equal(String.fromCharCode(...pieces), 'abc')
  f.cb.onHeaders(429, new Map())
  f.cb.onReadable.call(f.context, 2)
  f.cb.onDone()
  const r = await f.promise
  assert.equal(r.status, 429)
  assert.equal(r.body.byteLength, 2)
  f.connection.onError()
  f.expire()
  f.cb.onDone()
  assert.equal(f.closes, 1)
  assert.equal(f.cancels, 1)
})
test('zero writable capacity never terminates a content-length request body', async () => {
  const f = fixture(),
    pieces = []
  f.context.write = (view) => {
    assert.ok(view, 'fixed-length requests never use the chunked body terminator')
    pieces.push(...new Uint8Array(view.buffer, view.byteOffset, view.byteLength))
  }
  f.cb.onWritable.call(f.context, 0)
  f.cb.onWritable.call(f.context, 1)
  f.cb.onWritable.call(f.context, 0)
  f.cb.onWritable.call(f.context, 2)
  f.cb.onWritable.call(f.context, 0)
  f.cb.onHeaders(201, new Map())
  f.cb.onDone()
  assert.equal((await f.promise).status, 201)
  assert.equal(String.fromCharCode(...pieces), 'abc')
})

test('closing a client suppresses late DNS results without affecting the next client', () => {
  const lookups = [],
    sockets = [],
    errors = []
  let closes = 0
  class DNS {
    resolve(request) {
      lookups.push(request)
    }
  }
  class Client {
    constructor(options) {
      new options.dns.io(options.dns).resolve({
        host: options.host,
        onResolved: (host, address) => sockets.push({ host, address }),
        onError: options.onError,
      })
    }
    request(options) {
      return options
    }
    close() {
      closes++
    }
  }
  const options = { host: 'service.test', dns: { io: DNS }, onError: (error) => errors.push(error) }
  const first = createClosingClient(Client, options)
  assert.equal(first.request('request'), 'request')
  first.close()
  const second = createClosingClient(Client, options)
  lookups[0].onResolved('service.test', '192.0.2.1')
  lookups[0].onError(new Error('late DNS'))
  assert.deepEqual(sockets, [])
  assert.deepEqual(errors, [])
  lookups[1].onResolved('service.test', '192.0.2.2')
  assert.deepEqual(sockets, [{ host: 'service.test', address: '192.0.2.2' }])
  second.close()
  assert.equal(closes, 2)
})
test('every failure closes the SDK socket and settles the bounded request once', async () => {
  for (const fail of [
    (f) => f.expire(),
    (f) => f.connection.onError(),
    (f) => f.cb.onDone(),
    (f) => f.cb.onDone(new Error('socket')),
    (f) => f.cb.onHeaders(200, new Map([['content-length', '131073']])),
    (f) => {
      f.cb.onHeaders(200, new Map())
      f.cb.onReadable.call(f.context, 131073)
    },
  ]) {
    const f = fixture()
    fail(f)
    await assert.rejects(f.promise)
    f.cb.onHeaders(200, new Map())
    f.cb.onReadable.call(f.context, 1)
    f.cb.onDone()
    assert.equal(f.closes, 1)
    assert.equal(f.cancels, 1)
  }
})
function proxyFixture() {
  const timers = [],
    sent = []
  let workers = 0
  const worker = {
    postMessage(message) {
      sent.push(message)
    },
  }
  const fetch = createHttpProxy({
    createWorker() {
      workers++
      return worker
    },
    normalize,
    decode,
    now: () => 10,
    schedule(callback, ms) {
      const timer = { callback, ms }
      timers.push(timer)
      return timer
    },
    cancel(timer) {
      timer.cancelled = true
    },
  })
  return {
    fetch,
    timers,
    sent,
    worker,
    get workers() {
      return workers
    },
    post: (options = {}) => fetch('https://service/path', { method: 'POST', ...options }),
  }
}
test('the HTTP Worker is reused and independent responses retain their request identity', async () => {
  const f = proxyFixture(),
    a = f.post(),
    b = f.post()
  assert.equal(f.workers, 1)
  f.worker.onmessage({ id: f.sent[1].id, status: 201, body: encode('second') })
  f.worker.onmessage({ id: f.sent[0].id, status: 429, body: encode('first') })
  assert.equal(await (await b).text(), 'second')
  assert.equal((await a).ok, false)
  assert.equal(await (await a).text(), 'first')
  assert.ok(f.timers.every((t) => t.cancelled))
})
test('caller deadlines include Worker delivery/queue time; late replies cannot settle another request', async () => {
  const f = proxyFixture(),
    a = f.post({ timeoutMs: 1000 })
  assert.equal(f.sent[0].started, 10)
  f.timers[0].callback()
  await assert.rejects(a, /timed out/)
  const b = f.post()
  f.worker.onmessage({ id: f.sent[0].id, status: 200, body: encode('late') })
  f.worker.onmessage({ id: f.sent[1].id, error: 'socket failed' })
  await assert.rejects(b, /socket failed/)
})
test('IPC and request capacity failures reject without creating an unbounded queue', async () => {
  const f = proxyFixture(),
    requests = Array.from({ length: 8 }, () => f.post())
  await assert.rejects(f.post(), /capacity/)
  for (const m of f.sent) f.worker.onmessage({ id: m.id, status: 200, body: encode('') })
  await Promise.all(requests)
  f.worker.postMessage = () => {
    throw new Error('queue full')
  }
  await assert.rejects(f.post(), /queue full/)
  assert.ok(f.timers.at(-1).cancelled)
  const g = proxyFixture()
  await assert.rejects(g.fetch('http://insecure/a', { method: 'POST' }), URIError)
  assert.equal(g.sent.length, 0)
})

test('TLS callback exceptions become socket errors without escaping the I/O task', () => {
  class Socket {
    constructor(options) {
      this.options = options
    }
  }
  const errors = [],
    failure = new Error('certificate authentication failed')
  const Checked = guardSocketCallbacks(Socket)
  const socket = new Checked({
    format: 'buffer',
    onReadable(count) {
      assert.equal(this, socket)
      return count
    },
    onWritable() {
      throw failure
    },
    onError(error) {
      assert.equal(this, socket)
      errors.push(error)
    },
  })
  assert.equal(socket.options.format, 'buffer')
  assert.equal(socket.options.onReadable.call(socket, 42), 42)
  assert.doesNotThrow(() => socket.options.onWritable.call(socket, 1))
  assert.deepEqual(errors, [failure])
})

test('fragmented responses preserve every byte up to the response limit', async () => {
  const f = fixture()
  let offset = 0
  f.context.read = (view) => {
    for (let i = 0; i < view.length; i++) view[i] = (offset + i) % 251
    offset += view.length
    return view.length
  }
  f.cb.onHeaders(200, new Map())
  for (let i = 0; i < 128; i++) f.cb.onReadable.call(f.context, 1024)
  f.cb.onDone()
  const bytes = new Uint8Array((await f.promise).body)
  assert.equal(bytes.length, 131072)
  assert.ok(bytes.every((value, i) => value === i % 251))
  assert.equal(f.closes, 1)
})

test('streamed overflow rejects after earlier fragments were accepted', async () => {
  const f = fixture()
  f.cb.onHeaders(200, new Map())
  f.cb.onReadable.call(f.context, 131072)
  f.cb.onReadable.call(f.context, 1)
  await assert.rejects(f.promise, /limit/)
  assert.equal(f.closes, 1)
})
