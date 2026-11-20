import WebSocket from 'WebSocket'
import WebSocketHandshake from 'embedded:network/http/server/route/ws/handshake'
import { fetch } from 'fetch'
import { HttpServerService, Response } from 'http-server-service'
import { assert, equal } from 'testing/assert'
import Timer from 'timer'
import WavStreamer from 'wavstreamer'

// Real HTTP/WebSocket over loopback. Only AudioOut is replaced: the SDK still
// parses and streams network bytes, without opening an audio device.
let port
let httpPort

class AudioSink {
  static RawSamples = 1
  static Callback = 2
  static Flush = 3
  sampleRate = 8000
  bitsPerSample = 16
  samples = []
  callbacks = []

  length() {
    return 64
  }

  enqueue(stream, kind, value, _repeat, _offset, count) {
    if (kind === AudioSink.RawSamples) {
      const samples = new Int16Array(value.buffer, value.byteOffset, count)
      for (const sample of samples) this.samples.push(sample)
    } else if (kind === AudioSink.Callback) {
      Timer.set(() => this.callbacks[stream]?.(value))
    }
  }
}

async function echoWebSocket() {
  await new Promise((resolve, reject) => {
    const timeout = Timer.set(() => reject(new Error('WebSocket timeout')), 10000)
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`)
    socket.binaryType = 'arraybuffer'
    let messages = 0
    socket.addEventListener('open', () => socket.send('stack-chan'))
    socket.addEventListener('error', () => reject(new Error('WebSocket error')))
    socket.addEventListener('message', ({ data }) => {
      try {
        if (messages++ === 0) {
          equal(data, 'stack-chan', 'text WebSocket echo')
          socket.send(Uint8Array.of(0, 127, 128, 255).buffer)
        } else {
          if (!(data instanceof ArrayBuffer)) throw new Error('expected a binary WebSocket reply')
          equal([...new Uint8Array(data)].join(','), '0,127,128,255', 'binary bytes survive')
          socket.close()
          Timer.clear(timeout)
          resolve(undefined)
        }
      } catch (error) {
        reject(error)
      }
    })
  })
}

async function streamAudio() {
  // A minimal queue sink intentionally replaces the native AudioOut device.
  const out = /** @type {any} */ (new AudioSink())
  let ready = false
  let streamer
  try {
    await new Promise((resolve, reject) => {
      const timeout = Timer.set(() => reject(new Error('audio stream timeout')), 10000)
      streamer = new WavStreamer({
        http: globalThis.device.network.http.client,
        host: '127.0.0.1',
        port: httpPort,
        path: '/audio',
        audio: { out, stream: 0 },
        bufferDuration: 32,
        onReady(value) {
          ready ||= value
        },
        onError(error) {
          Timer.clear(timeout)
          reject(new Error(`audio stream: ${error}`))
        },
        onDone() {
          Timer.clear(timeout)
          resolve(undefined)
        },
      })
    })
    assert(ready, 'stream reached playback readiness')
    equal(out.samples.length, 2048, 'all streamed PCM samples reach AudioOut')
    for (let i = 0; i < out.samples.length; i++) {
      equal(out.samples[i], i - 1024, `PCM sample ${i}, including network endian conversion`)
    }
  } finally {
    streamer?.close()
  }
}

let app
let server
let peer
try {
  app = new HttpServerService({ port: 0 })
  httpPort = app.port
  app.post('/echo', async (context) => context.json(await context.req.json()))
  const pcm = new ArrayBuffer(4096)
  const view = new DataView(pcm)
  for (let i = 0; i < 2048; i++) view.setInt16(i * 2, i - 1024)
  app.get('/audio', () => new Response(pcm, { headers: { 'Content-Type': 'audio/L16;rate=8000&channels=1' } }))
  server = new globalThis.device.network.http.server.io({
    ...globalThis.device.network.http.server,
    port: 0,
    onRoute: () => ({
      ...WebSocketHandshake,
      /** @this {import('embedded:network/http/server').HTTPConnection} */
      onDone() {
        peer = new WebSocket({ attach: this.detach() })
        peer.binaryType = 'arraybuffer'
        peer.addEventListener('message', ({ data }) => peer.send(data))
      },
    }),
  })
  port = server.port
  const response = await fetch(`http://127.0.0.1:${httpPort}/echo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'stack-chan', sequence: 42 }),
  })
  equal(response.status, 200, 'fetch reaches Stack-chan HTTP service')
  const value = await response.json()
  equal(value.message, 'stack-chan', 'fetch JSON body')
  equal(value.sequence, 42, 'fetch JSON numeric value')
  await echoWebSocket()
  await streamAudio()
  trace('HTTP fetch, WebSocket text/binary, PCM streaming: ok\n')
  trace('@@STACKCHAN_TEST:PASS@@\n')
} catch (error) {
  trace(`@@STACKCHAN_TEST:FAIL@@\n${error}\n`)
  throw error
} finally {
  peer?.close()
  server?.close()
  app?.close()
}
