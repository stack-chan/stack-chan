import { connect, http, lastResolver, Resolver, Socket } from 'http-playback-network'
import AudioOut from 'pins/audioout'
import { assert, equal } from 'testing/assert'
import { TTS as ElevenLabs } from 'tts-elevenlabs'
import { MAX_TTS_JSON_BYTES } from 'tts-http-client'
import { requestTTSQuery } from 'tts-http-query'
import { TTS as OpenAI } from 'tts-openai'
import { createPlaybackSession, PlaybackProvider, playbackReleaseFailure } from 'tts-playback-session'
import { TTS as Remote } from 'tts-remote'
import { TTS as Voicevox } from 'tts-voicevox'
import { TTS as VoicevoxWeb } from 'tts-voicevox-web'
import Streamer from 'wavstreamer'

async function observe(promise: Promise<unknown>) {
  try {
    return { value: await promise, error: undefined }
  } catch (error) {
    return { value: undefined, error: error as { code?: string } }
  }
}

function query(timeoutMs?: number) {
  const owner = new PlaybackProvider()
  const session = createPlaybackSession(owner)
  const response = requestTTSQuery(session, { http, host: 'voice.test', port: 80, path: '/query', timeoutMs })
  response.then(() => session.onDone(), session.fail)
  return { owner, session, result: observe(response) }
}

async function run() {
  Object.defineProperty(globalThis, 'device', {
    configurable: true,
    value: { network: { http: { client: http }, https: { client: http } } },
  })

  // Use the real SDK HTTP parser and Timer, with controlled DNS and TCP I/O.
  for (let trial = 0; trial < 100; trial++) {
    const current = query()
    const socket = connect()
    socket.respond('{"text":"こんにちは"}')
    equal((await current.result).error, undefined)
    await current.session.released
    equal(socket.closes, 1, 'successful preparation releases HTTP')
    equal(socket.closesInCallback, 0, 'HTTP callback returns before socket release')
    equal(lastResolver().closes, 1, 'successful preparation releases its DNS resolver')

    const cancelled = query()
    const resolver = lastResolver()
    const acquired = Socket.instances.length
    await cancelled.session.cancel()
    equal((await cancelled.result).error?.code, 'CANCELLED')
    resolver.succeed()
    resolver.fail()
    equal(Socket.instances.length, acquired, 'late DNS responses cannot create a socket after cancellation')
    equal(resolver.closes, 1, 'cancelled DNS is released once')
  }

  const timedOut = query(5)
  equal((await timedOut.result).error?.code, 'TIMEOUT', 'DNS preparation has a deadline')
  await timedOut.session.released
  equal(lastResolver().closes, 1, 'timeout releases unresolved DNS')

  for (const invalid of ['status', 'json', 'announced size', 'streamed size']) {
    const current = query()
    const socket = connect()
    if (invalid === 'status') socket.respond('{}', 503)
    else if (invalid === 'json') socket.respond('not JSON')
    else if (invalid === 'announced size')
      socket.receive(`HTTP/1.1 200 OK\r\nContent-Length: ${MAX_TTS_JSON_BYTES + 1}\r\n\r\n`)
    else
      socket.receive(
        `HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n${(MAX_TTS_JSON_BYTES + 1).toString(16)}\r\n${'x'.repeat(MAX_TTS_JSON_BYTES + 1)}\r\n0\r\n\r\n`,
      )
    equal((await current.result).error?.code, 'IO', `${invalid} is a failed preparation`)
    await current.session.released
    equal(socket.closes, 1, `${invalid} closes the connection`)
  }

  for (const phase of ['dns', 'socket']) {
    Resolver.resolveFailure = phase === 'dns'
    Socket.constructorFailure = phase === 'socket'
    const current = query()
    if (phase === 'socket') lastResolver().succeed()
    equal((await current.result).error?.code, 'IO', `${phase} constructor failure reaches the operation`)
    await current.session.released
    equal(lastResolver().closes, 1, `${phase} constructor failure releases already acquired DNS`)
    Resolver.resolveFailure = Socket.constructorFailure = false
  }

  const broken = query()
  const brokenSocket = connect()
  brokenSocket.closeFailure = true
  brokenSocket.respond('{}')
  equal((await broken.result).error?.code, 'IO', 'cleanup failure cannot become successful preparation')
  equal(
    (await observe(broken.session.released)).error?.code,
    'IO',
    'preparation release failure propagates to playback',
  )
  assert(playbackReleaseFailure(broken.owner), 'failed shared transport remains faulted')
  equal(lastResolver().closes, 1, 'DNS cleanup is still attempted after socket close fails')

  const native = new Voicevox({ host: 'voice.test', port: 50021, sampleRate: 16000 })
  const prepared = new Promise<Streamer>((resolve) => {
    Streamer.onCreated = resolve
  })
  const completed = new Promise<unknown>((resolve) => native.stream('日本語 & ? #', 0.25, resolve))
  const preparationSocket = connect()
  assert(
    preparationSocket.written.includes(`text=${encodeURIComponent('日本語 & ? #')}&speaker=1`),
    'text is encoded as one query parameter',
  )
  preparationSocket.respond('{"outputSamplingRate":24000,"outputStereo":false,"accent_phrases":[]}')
  const stream = await prepared
  Streamer.onCreated = undefined
  const synthesisSocket = connect()
  const synthesis = JSON.parse(synthesisSocket.written.split('\r\n\r\n')[1])
  equal(synthesis.outputSamplingRate, 16000, 'sampling rate replaces the returned property')
  equal(synthesis.outputStereo, false, 'preparation preserves the other query fields')
  stream.done()
  equal(await completed, undefined)
  equal(synthesisSocket.closes, 1, 'synthesis HTTP closes with playback')
  await native.close()

  // Cancellation before preparation returns must not open the speaker later.
  const cancelledProvider = new Voicevox({ host: 'voice.test', port: 50021 })
  const cancelledCompletion = new Promise<unknown>((resolve) =>
    cancelledProvider.stream('キャンセル', undefined, resolve),
  )
  const audioCount = AudioOut.instances.length
  const delayedDNS = lastResolver()
  await cancelledProvider.close()
  assert((await cancelledCompletion) instanceof Error)
  delayedDNS.succeed()
  equal(AudioOut.instances.length, audioCount, 'closed preparation cannot acquire AudioOut')

  const web = new VoicevoxWeb({ token: 'key&secret', sampleRate: 44100 })
  const webPrepared = new Promise<Streamer>((resolve) => {
    Streamer.onCreated = resolve
  })
  const webCompletion = new Promise<unknown>((resolve) => web.stream('URL?値', undefined, resolve))
  const webQuery = connect()
  assert(webQuery.written.includes('key=key%26secret'), 'credentials remain in one query parameter')
  webQuery.respond('{"mp3StreamingUrl":"https://audio.test:8443/play.mp3?token=a%26b"}')
  const webStream = await webPrepared
  Streamer.onCreated = undefined
  equal(webStream.options.host, 'audio.test')
  equal(webStream.options.port, 8443)
  equal(webStream.options.path, '/play.mp3?token=a%26b', 'stream URL query parameters are preserved')
  equal(webStream.options.audio.out.sampleRate, 44100, 'configured web sample rate is honored')
  webStream.done()
  equal(await webCompletion, undefined)
  await web.close()

  for (const provider of [
    new OpenAI({ token: 'openai-key' }),
    new ElevenLabs({ token: 'eleven-key' }),
    new Remote({ host: 'audio.test', port: 80 }),
  ]) {
    const result = new Promise<unknown>((resolve) => provider.stream('hello', undefined, resolve))
    const socket = connect()
    if (!(provider instanceof Remote)) {
      const body = JSON.parse(socket.written.split('\r\n\r\n')[1])
      equal(body.input ?? body.text, 'hello', 'provider serializes the requested text')
    }
    Streamer.instances[Streamer.instances.length - 1].done()
    equal(await result, undefined)
    equal(socket.closes, 1, 'all network providers release the same HTTP owner')
    equal(lastResolver().closes, 1, 'all network providers release DNS')
    await provider.close()
  }

  Streamer.constructorFailure = true
  const rollback = new OpenAI({ token: 'test-key' })
  const rollbackError = await new Promise<unknown>((resolve) => rollback.stream('hello', undefined, resolve))
  assert(rollbackError instanceof Error, 'failed streamer construction completes with failure')
  equal(lastResolver().closes, 1, 'an HTTP client acquired inside the failed constructor is released')
  equal(AudioOut.instances[AudioOut.instances.length - 1].closes, 1, 'failed streamer construction releases output')
  Streamer.constructorFailure = false
  await rollback.close()
  trace('ok\n')
}

Promise.resolve()
  .then(run)
  .catch((error) => trace(`FAIL ${error?.stack ?? error}\n`))
