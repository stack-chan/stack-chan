import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { registerHooks, stripTypeScriptTypes } from 'node:module'
import test, { beforeEach } from 'node:test'

ArrayBuffer.fromString = (value) => new TextEncoder().encode(value).buffer
String.fromArrayBuffer = (value) => new TextDecoder().decode(value)
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'timer') return next(new URL('../../testing/fakes/timer.ts', import.meta.url).href, context)
    if (specifier.startsWith('stackchan/voice/'))
      return next(new URL(`../${specifier.slice(16)}.ts`, import.meta.url).href, context)
    if (specifier.startsWith('stackchan-ai-'))
      return next(new URL(`../../ai/ai-${specifier.slice(13)}.ts`, import.meta.url).href, context)
    return next(specifier, context)
  },
  load(url, context, next) {
    if (url.endsWith('/ai-wire.ts'))
      return {
        shortCircuit: true,
        format: 'module',
        source: stripTypeScriptTypes(readFileSync(new URL(url), 'utf8'), { mode: 'strip' }),
      }
    return next(url, context)
  },
})
const { createServer } = await import('node:http')
const { request: httpRequest } = await import('node:http')
const { createServer: createSecureServer, request: httpsRequest } = await import('node:https')
const { GeminiSpeechTTS } = await import('../gemini-speech.ts')
const { mono, subscribePcmSource } = await import('../media.ts')
const { createVoiceScope } = await import('../scope.ts')
const { default: Timer } = await import('../../testing/fakes/timer.ts')
const terminal = Buffer.from('data: {"event_type":"interaction.completed","interaction":{"status":"completed"}}\n\n')
const pcm = Buffer.from(Array.from({ length: 36000 }, (_, i) => (i * 17 + 3) & 255))
const frame = Buffer.from(
  `data: ${JSON.stringify({
    event_type: 'step.delta',
    delta: {
      type: 'audio',
      mime_type: 'audio/l16;rate=24000',
      data: pcm.toString('base64'),
    },
  })}\n\n`,
)
const pause = () => new Promise((resolve) => setImmediate(resolve))
beforeEach(() => Timer.reset())

// Node's HTTP parser is an independent strict-framing fixture, not the ESP32 SDK transport.
// It deliberately waits for HTTP EOF instead of applying streamResponse's isComplete early-success policy.
// Owned/unread terminal races are tested against streamResponse in ai-http-stream.test.ts.
// Sink yields test serial backpressure, not a guaranteed overlap with the peer's FIN.
async function playback(t, mode, secure = false) {
  let responseEnded = false,
    socketClosed = false,
    requestEnded = false
  let outstanding = 0,
    peakOutstanding = 0,
    settlements = 0
  const received = []
  const payload = mode === 'missing-terminal' ? frame : Buffer.concat([frame, terminal])
  const handler = (req, res) => {
    req.resume()
    const truncated = mode === 'truncated-http'
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      connection: 'close',
      'content-length': payload.length + (truncated ? 100 : 0),
    })
    res.end(payload, () => {
      responseEnded = true
    })
  }
  const server = secure
    ? createSecureServer(
        {
          cert: readFileSync(process.env.MOCK_TLS_CERT),
          key: readFileSync(process.env.MOCK_TLS_KEY),
        },
        handler,
      )
    : createServer(handler)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => {
    server.closeAllConnections()
    server.close()
  })
  const speech = await GeminiSpeechTTS.create({
    request(body, consume, scope) {
      return new Promise((resolve, reject) => {
        const req = (secure ? httpsRequest : httpRequest)(
          {
            ...(secure ? { ca: readFileSync(process.env.MOCK_TLS_CA) } : {}),
            host: '127.0.0.1',
            port: server.address().port,
            method: 'POST',
            headers: { 'content-length': body.length, connection: 'close' },
          },
          async (res) => {
            res.on('close', () => {
              socketClosed = true
            })
            try {
              for await (const chunk of res) {
                for (let start = 0; start < chunk.length; start += 257)
                  await consume(chunk.subarray(start, start + 257))
              }
              assert.equal(res.complete, true)
              requestEnded = true
              resolve()
            } catch (error) {
              reject(error)
            }
          },
        )
        req.on('error', reject)
        const abort = () => req.destroy(new Error('fixture cancelled'))
        scope.signal.addEventListener('abort', abort, { once: true })
        req.on('close', () => scope.signal.removeEventListener('abort', abort))
        for (const chunk of body.read()) req.write(chunk)
        req.end()
      })
    },
  }).open({ ...createVoiceScope(), format: mono(24000), voice: 'Leda' })
  t.after(() => speech.close())
  subscribePcmSource(speech.output, {
    async write(bytes) {
      outstanding++
      peakOutstanding = Math.max(peakOutstanding, outstanding)
      received.push(Buffer.from(bytes))
      await pause()
      outstanding--
    },
    end() {},
  })
  await speech.write('Deterministic local transport fixture')
  const result = await speech.endInput().then(
    () => {
      settlements++
      return undefined
    },
    (error) => {
      settlements++
      return error
    },
  )
  await pause()
  await speech.close()
  await pause()
  assert.equal(settlements, 1)
  assert.equal(outstanding, 0)
  assert.ok(peakOutstanding <= 1)
  assert.ok(received.length > 1, 'the fixture must exercise multiple bounded sink writes')
  assert.ok(received.every((bytes) => bytes.length <= 24576))
  assert.equal(responseEnded, true)
  assert.equal(socketClosed, true)
  return { error: result, received: Buffer.concat(received), requestEnded }
}

test('loopback HTTP clean FIN preserves every PCM byte through a delayed bounded sink', {
  timeout: 5000,
}, async (t) => {
  const result = await playback(t, 'complete')
  assert.equal(result.error, undefined)
  assert.deepEqual(result.received, pcm)
  assert.equal(result.requestEnded, true)
})

test('loopback HTTP clean FIN without application terminal fails after preserving PCM', {
  timeout: 5000,
}, async (t) => {
  const result = await playback(t, 'missing-terminal')
  assert.equal(result.error.code, 'provider_failed')
  assert.deepEqual(result.received, pcm)
  assert.equal(result.requestEnded, true)
})

test('strict Node HTTP fixture rejects incomplete framing despite a terminal in the sent payload', {
  timeout: 5000,
}, async (t) => {
  const result = await playback(t, 'truncated-http')
  assert.equal(result.error.code, 'ECONNRESET')
  assert.equal(result.requestEnded, false)
  assert.deepEqual(result.received, pcm.subarray(0, result.received.length))
})

for (const mode of ['complete', 'missing-terminal', 'truncated-http']) {
  test(`strict Node verified TLS fixture ${mode} retains the HTTP/application completion distinction`, {
    timeout: 5000,
    skip: !(process.env.MOCK_TLS_CERT && process.env.MOCK_TLS_KEY && process.env.MOCK_TLS_CA),
  }, async (t) => {
    const result = await playback(t, mode, true)
    if (mode === 'complete') {
      assert.equal(result.error, undefined)
      assert.deepEqual(result.received, pcm)
      assert.equal(result.requestEnded, true)
    } else {
      assert.equal(result.error.code, mode === 'missing-terminal' ? 'provider_failed' : 'ECONNRESET')
      if (mode === 'missing-terminal') {
        assert.deepEqual(result.received, pcm)
        assert.equal(result.requestEnded, true)
      } else {
        assert.deepEqual(result.received, pcm.subarray(0, result.received.length))
        assert.equal(result.requestEnded, false)
      }
    }
  })
}
