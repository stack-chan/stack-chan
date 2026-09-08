import requestHttp from 'app-http'
import { CancellationSource } from 'cancellation'
import { assert, equal } from 'testing/assert'

let current
class Client {
  constructor() {
    current = this
    this.closed = 0
    this.writes = []
  }
  request(options) {
    this.options = options
  }
  write(view) {
    assert(view instanceof DataView, 'fixed-length bodies must not send a chunked terminator')
    this.writes.push(view)
  }
  read() {
    return this.nextChunk
  }
  close() {
    this.closed++
  }
  receive(text) {
    this.nextChunk = ArrayBuffer.fromString(text)
    this.options.onReadable.call(this, this.nextChunk.byteLength)
  }
}
globalThis.device = { network: { http: { client: { io: Client } } } }

async function rejects(promise, code) {
  let error
  try {
    await promise
  } catch (value) {
    error = value
  }
  equal(error?.code, code)
}
async function run() {
  const recording = ArrayBuffer.fromString('recording')
  const pending = requestHttp({
    url: 'http://test.local/upload?a=1',
    method: 'POST',
    body: [ArrayBuffer.fromString('head'), recording, ArrayBuffer.fromString('tail')],
  })
  const client = current
  equal(client.options.path, '/upload?a=1')
  equal(client.options.headers.get('content-length'), '17')
  client.options.onWritable.call(client, 6)
  client.options.onWritable.call(client, 50)
  client.options.onWritable.call(client, 50)
  equal(
    client.writes.reduce((sum, view) => sum + view.byteLength, 0),
    17,
  )
  assert(
    client.writes.some((view) => view.buffer === recording),
    'upload views borrow the original recording',
  )
  client.options.onHeaders(
    201,
    new Map([
      ['Content-Type', 'application/json'],
      ['Mcp-Session-Id', 'test-session'],
    ]),
  )
  client.receive('{"text":')
  client.receive('"hello"}')
  client.options.onDone(null)
  const response = await pending
  equal(response.status, 201)
  equal(response.body, '{"text":"hello"}')
  equal(response.headers['mcp-session-id'], 'test-session')
  equal(client.closed, 1)
  client.options.onDone(new Error('late callback'))
  equal(client.closed, 1)

  const source = new CancellationSource()
  const aborted = rejects(requestHttp({ url: 'http://test.local/wait' }, source.signal), 'CANCELLED')
  const cancelling = current
  source.cancel()
  await aborted
  equal(cancelling.closed, 1, 'cancellation closes physical HTTP client')

  const limited = rejects(requestHttp({ url: 'http://test.local/large', maxResponseBytes: 3 }), 'IO')
  const overflowing = current
  overflowing.receive('1234')
  await limited
  equal(overflowing.closed, 1)

  const frames = []
  const streaming = requestHttp({
    url: 'http://test.local/live',
    maxResponseBytes: 4,
    onChunk: (chunk) => frames.push(String.fromArrayBuffer(chunk)),
  })
  const live = current
  live.options.onHeaders(200)
  for (let i = 0; i < 20; i++) live.receive('data')
  live.options.onDone()
  await streaming
  equal(frames.length, 20, 'streaming does not accumulate the total response in memory')
  equal(live.closed, 1)

  for (const operation of ['write', 'read']) {
    const failed = rejects(requestHttp({ url: 'http://test.local/io-failure', method: 'POST', body: 'test' }), 'IO')
    const device = current
    device[operation] = () => {
      throw new Error('native I/O failed')
    }
    if (operation === 'write') device.options.onWritable.call(device, 4)
    else device.options.onReadable.call(device, 4)
    await failed
    equal(device.closed, 1, 'native callback errors close the request instead of aborting XS')
    device.options.onDone(null)
    equal(device.closed, 1)
  }

  const timed = rejects(requestHttp({ url: 'http://test.local/idle', timeoutMs: 5 }), 'TIMEOUT')
  const idle = current
  await timed
  equal(idle.closed, 1)
  trace('ok\n')
}
run().catch((error) => {
  trace(`app HTTP failed: ${error}\n`)
  throw error
})
