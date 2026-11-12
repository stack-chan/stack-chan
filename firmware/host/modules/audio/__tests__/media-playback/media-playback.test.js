import 'podcast-rss-tests'
import { createAudioRuntime } from 'stackchan/voice/device'
import { createVoiceScope } from 'stackchan/voice/scope'
import { mono } from 'stackchan/voice/media'
import { outputs } from 'embedded:io/audio/out'
import Core from 'buffered-mp3streamer-core'
import MediaHttpStream, { mediaRedirectURL } from 'media-http'
import MediaPlayer from 'media-player'
import { PodcastController } from 'podcast-controller'
import { loadFeed } from 'podcast-feed'
import { loadFeed as loadWorkerFeed } from 'podcast-feed-proxy'
import Client, { clients } from 'test-http'
import { assert, equal } from 'testing/assert'
import Timer from 'timer'
import AudioOut from 'web-radio-audio-out'
import { SharedByteRing } from 'web-radio-byte-ring'
import { workers } from 'worker'

async function runTests() {
  trace('media tests started\n')
  const runtime = createAudioRuntime({ acquireExclusive: () => () => {} })
  const getSpeaker = () => runtime.speaker
  const settle = async () => {
    for (let n = 0; n < 32; n++) await Promise.resolve()
  }
  async function drainDriver(driver) {
    for (let n = 0; n < 8; n++) {
      driver.writable(10240)
      await settle()
    }
  }
  function frame(rate = 44100) {
    const bytes = new Uint8Array(rate === 44100 ? 417 : 384)
    bytes.set([255, 251, rate === 44100 ? 0x90 : 0x94, 0])
    return bytes
  }
  function put(ring, bytes) {
    let position = 0
    while (position < bytes.length) {
      const view = ring.writableView(bytes.length - position)
      view.set(bytes.subarray(position, position + view.length))
      ring.advanceWrite(view.length)
      position += view.length
    }
  }
  function lastClient() {
    return clients[clients.length - 1]
  }
  function tick() {
    Timer.advance(0)
  }
  function throws(callback, message) {
    let caught = false
    try {
      callback()
    } catch {
      caught = true
    }
    assert(caught, message)
  }
  globalThis.device = { network: { http: { client: { io: Client } }, https: { client: { io: Client } } } }

  // Redirects do not enter the body consumer, and protocols/relative paths change together.
  let bodyCalls = 0,
    done = 0,
    error
  let request = new MediaHttpStream({
    url: 'http://example.test/start',
    onReadable: () => {
      bodyCalls++
      request.read(new Uint8Array(request.readable))
    },
    onDone: (reason) => {
      done++
      error = reason
    },
  })
  tick()
  const old = lastClient()
  old.headers(302, { location: 'https://cdn.test/a/b' })
  tick()
  equal(lastClient().options.port, 443)
  lastClient().headers(307, { location: '../episode?x=1' })
  tick()
  equal(lastClient().callbacks.path, '/episode?x=1')
  old.data(frame())
  equal(bodyCalls, 0)
  lastClient().headers(200, { 'content-length': '4' })
  lastClient().data(new Uint8Array(4))
  lastClient().done()
  equal(done, 1)
  equal(error, undefined)
  lastClient().done()
  equal(done, 1)

  // HTTPS remains authenticated across every redirect; direct HTTP is still supported.
  equal(mediaRedirectURL('../art.jpg', 'https://example.test/show/episode').href, 'https://example.test/art.jpg')
  throws(() => mediaRedirectURL('http://cdn.test/art.jpg', 'https://example.test/'), 'reject artwork downgrade')
  request = new MediaHttpStream({
    url: 'http://example.test/start',
    onDone: (reason) => {
      error = reason
    },
  })
  tick()
  lastClient().headers(302, { location: 'https://cdn.test/secure' })
  tick()
  const secure = lastClient()
  const secureCount = clients.length
  secure.headers(302, { location: 'http://example.test/insecure' })
  tick()
  assert(error, 'HTTPS-to-HTTP redirect fails')
  equal(clients.length, secureCount, 'downgrade must not open an HTTP connection')
  assert(secure.closed)

  for (const mode of ['length', 'unframed', 'http', 'encoding', 'redirect', 'timeout', 'cancel']) {
    error = undefined
    done = 0
    request = new MediaHttpStream({
      url: 'https://example.test/',
      onDone: (reason) => {
        done++
        error = reason
      },
    })
    tick()
    if (mode === 'length') {
      lastClient().headers(200, { 'content-length': '10' })
      lastClient().done()
    }
    if (mode === 'unframed') {
      lastClient().headers()
      lastClient().done()
    }
    if (mode === 'http') lastClient().headers(404)
    if (mode === 'encoding') lastClient().headers(200, { 'content-encoding': 'gzip' })
    if (mode === 'redirect')
      for (let n = 0; n < 6; n++) {
        lastClient().headers(302, { location: '/loop' })
        tick()
      }
    if (mode === 'timeout') Timer.advance(10000)
    if (mode === 'cancel') {
      const stale = lastClient()
      request.close()
      stale.done()
      equal(done, 0)
      continue
    }
    equal(done, 1, mode)
    assert(error, mode)
  }
  request = new MediaHttpStream({
    url: 'https://example.test/',
    onDone: (reason) => {
      error = reason
    },
  })
  tick()
  error = undefined
  lastClient().headers(200, { 'transfer-encoding': 'chunked' })
  lastClient().data(new Uint8Array(8))
  Timer.advance(20000)
  assert(!error, 'backpressure must not time out')
  request.read(new Uint8Array(8))
  lastClient().done()
  equal(error, undefined)

  // Range responses must describe the exact suffix. Servers may ignore Range safely.
  for (const mode of ['partial', 'ignored', 'wrong', 'missing', 'length']) {
    let info, failure
    request = new MediaHttpStream({
      url: 'https://example.test/audio',
      rangeStart: 100,
      ifRange: '"episode"',
      onHeaders: (_headers, _url, value) => {
        info = value
      },
      onDone: (reason) => {
        failure = reason
      },
    })
    tick()
    equal(lastClient().callbacks.headers.get('range'), 'bytes=100-')
    equal(lastClient().callbacks.headers.get('if-range'), '"episode"')
    if (mode === 'ignored') lastClient().headers(200, { 'content-length': '200' })
    else
      lastClient().headers(206, {
        'content-length': mode === 'length' ? '99' : '100',
        'content-range': mode === 'missing' ? '' : mode === 'wrong' ? 'bytes 50-149/200' : 'bytes 100-199/200',
      })
    if (mode === 'partial' || mode === 'ignored') {
      equal(info.start, mode === 'partial' ? 100 : 0)
      equal(info.totalBytes, 200)
      assert(!failure)
    } else assert(failure, `invalid range: ${mode}`)
    request.close()
  }

  // Cancelling DNS must prevent the SDK from opening a socket afterwards.
  {
    let resolution
    const provider = device.network.http.client
    provider.dns = {
      io: class {
        resolve(options) {
          resolution = options
        }
      },
    }
    const pending = new MediaHttpStream({ url: 'http://example.test/' })
    tick()
    const client = lastClient()
    pending.close()
    resolution.onResolved('example.test', '127.0.0.1')
    assert(!client.resolved, 'cancelled DNS must not connect')
    delete provider.dns
  }

  // Core decoder: a single frame below both prebuffer thresholds still plays at EOF.
  class Sink {
    static RawSamples = 5
    static Callback = 3
    static Flush = 2
    callbacks = []
    queued = []
    frames = 0
    samples = 0
    enqueue(_stream, kind, value) {
      if (kind === 3) this.queued.push(value)
      if (kind === 5) {
        this.frames++
        this.samples += value.samples
      }
    }
    length() {
      return 48
    }
    complete() {
      while (this.queued.length) this.callbacks[0](this.queued.shift())
    }
  }
  for (const rate of [44100, 48000]) {
    const input = SharedByteRing.allocate(8192),
      audio = new Sink()
    let ready = 0,
      ended = 0
    put(input, frame(rate))
    const core = new Core({
      input: input.buffers,
      audio: { out: audio },
      onReady: (value) => {
        if (value) ready++
      },
      onDone: () => ended++,
    })
    core.pump()
    equal(audio.frames, 0)
    core.end()
    core.pump()
    equal(ready, 1)
    equal(audio.frames, 1)
    equal(ended, 0)
    audio.complete()
    core.pump()
    equal(ended, 1)
    core.close()
  }
  // Artwork larger than the read buffer is skipped without treating embedded sync as audio.
  {
    const input = SharedByteRing.allocate(262144),
      audio = new Sink()
    const tag = new Uint8Array(180010)
    tag.set([73, 68, 51, 4, 0, 0, 0, 10, 126, 32]) // 180000 bytes
    tag.set(frame(), 100)
    put(input, tag)
    put(input, frame())
    const core = new Core({ input: input.buffers, audio: { out: audio } })
    core.end()
    core.pump()
    audio.complete()
    equal(audio.frames, 1)
    core.close()
  }
  {
    const input = SharedByteRing.allocate(8192),
      audio = new Sink()
    put(input, frame().subarray(0, 100))
    const core = new Core({ input: input.buffers, audio: { out: audio } })
    core.end()
    throws(() => core.pump(), 'truncated frame must fail')
    core.close()
  }
  // VBR seeking walks real frame durations, trims within a frame, and indexes absolute offsets.
  for (const resumed of [false, true]) {
    const input = SharedByteRing.allocate(65536),
      audio = new Sink(),
      points = [],
      metadata = []
    const start = resumed ? 20 : 0,
      offset = resumed ? 9876 : 10
    if (!resumed) put(input, new Uint8Array([73, 68, 51, 4, 0, 0, 0, 0, 0, 0]))
    let bytes = 0
    for (let n = 0; n < 80; n++) {
      const chunk = new Uint8Array(n % 2 ? 522 : 417)
      chunk.set([255, 251, n % 2 ? 0xa0 : 0x90, 0])
      put(input, chunk)
      bytes += chunk.length
    }
    const target = start + 1.5
    let outputStart
    const core = new Core({
      input: input.buffers,
      audio: { out: audio },
      mode: 'finite',
      seekSeconds: target,
      onCheckpoint: (point) => points.push(point),
      onMetadata: (value) => metadata.push(value),
      onOutputStart: (seconds) => {
        outputStart = seconds
      },
    })
    core.source({ offset: resumed ? offset : 0, seconds: start, totalBytes: offset + bytes })
    core.end()
    for (let n = 0; n < 10; n++) {
      core.pump()
      audio.complete()
    }
    equal(points[0].offset, offset)
    equal(points[0].seconds, start)
    assert(Math.abs(outputStart - target) < 1 / 44100, 'seek starts at target sample')
    equal(audio.samples, 80 * 1152 - 66150, 'discard exactly the PCM before target')
    assert(Math.abs(metadata.at(-1).duration - (start + (80 * 1152) / 44100)) < 0.00001)
    assert(
      metadata.some((value) => value.duration === undefined),
      'VBR invalidates CBR estimate',
    )
    core.close()
  }
  {
    const input = SharedByteRing.allocate(262144),
      audio = new Sink(),
      hints = []
    for (let n = 0; n < 160; n++) put(input, frame())
    const variable = new Uint8Array(522)
    variable.set([255, 251, 0xa0, 0])
    put(input, variable)
    const core = new Core({
      input: input.buffers,
      mode: 'finite',
      audio: { out: audio },
      onSeekInfo: (value) => hints.push(value),
    })
    core.source({ totalBytes: 160 * 417 + variable.length })
    core.end()
    for (let n = 0; n < 8; n++) {
      core.pump()
      audio.complete()
    }
    assert(
      hints.some((value) => value?.bitRate === 128000),
      'a constant prefix offers an approximate seek candidate',
    )
    equal(hints.at(-1), null, 'later VBR invalidates the candidate')
    core.close()
  }
  {
    const input = SharedByteRing.allocate(131072),
      audio = new Sink(),
      points = [],
      metadata = []
    const prefix = new Uint8Array(137)
    prefix.set(frame().subarray(0, 4), 10)
    put(input, prefix)
    for (let n = 0; n < 128; n++) put(input, frame())
    let outputStart,
      approximate,
      rejected = 0
    const core = new Core({
      input: input.buffers,
      mode: 'finite',
      seekSeconds: 120,
      audio: { out: audio },
      onCheckpoint: (value) => points.push(value),
      onMetadata: (value) => metadata.push(value),
      onOutputStart: (seconds, estimated) => {
        outputStart = seconds
        approximate = estimated
      },
      onSeekInvalid: () => rejected++,
    })
    core.source({
      offset: 1888034,
      seconds: 118,
      estimated: true,
      synchronize: true,
      cbr: { offset: 34, bitRate: 128000, sampleRate: 44100, version: 3, layer: 1 },
    })
    core.end()
    for (let n = 0; n < 8; n++) {
      core.pump()
      audio.complete()
    }
    equal(rejected, 0)
    equal(points[0].offset, 1888034 + prefix.length, 'false header must not become the time anchor')
    assert(
      points.every((point) => point.estimated),
      'derived checkpoints retain their approximate clock',
    )
    assert(Math.abs(outputStart - 120) < 1 / 44100)
    assert(approximate, 'preroll cannot establish an absolute exact timestamp')
    assert(metadata.at(-1).estimated, 'EOF cannot make an approximate timeline exact')
    core.close()
  }
  {
    const input = SharedByteRing.allocate(32768),
      audio = new Sink()
    put(input, new Uint8Array(20000))
    let invalid = 0
    const core = new Core({
      input: input.buffers,
      mode: 'finite',
      seekSeconds: 120,
      audio: { out: audio },
      onSeekInvalid: () => invalid++,
    })
    core.source({
      offset: 1000,
      seconds: 118,
      estimated: true,
      synchronize: true,
      cbr: { offset: 0, bitRate: 128000, sampleRate: 44100, version: 3, layer: 1 },
    })
    core.pump()
    core.pump()
    equal(invalid, 1, 'unusable approximate range requests one exact fallback')
    equal(audio.frames, 0)
    core.close()
  }
  for (const estimated of [false, true]) {
    const input = SharedByteRing.allocate(131072),
      audio = new Sink(),
      hints = [],
      metadata = []
    for (let n = 0; n < 160; n++) put(input, frame())
    const variable = new Uint8Array(522)
    variable.set([255, 251, 0xa0, 0])
    put(input, variable)
    let invalid = 0
    const core = new Core({
      input: input.buffers,
      mode: 'finite',
      seekSeconds: 20,
      audio: { out: audio },
      onSeekInfo: (value) => hints.push(value),
      onSeekInvalid: () => invalid++,
      onMetadata: (value) => metadata.push(value),
    })
    core.source({
      offset: 100000,
      seconds: 20,
      estimated,
      cbr: { offset: 0, bitRate: 128000, sampleRate: 44100, version: 3, layer: 1 },
    })
    core.end()
    for (let n = 0; n < 8; n++) {
      core.pump()
      audio.complete()
    }
    equal(hints.at(-1), null, 'VBR observed after a checkpoint resume invalidates CBR extrapolation')
    equal(invalid, 0, 'observed checkpoint playback must not restart after output')
    equal(metadata.at(-1).estimated, estimated, 'resumed timelines retain their original precision')
    assert(audio.samples > 0)
    core.close()
  }
  {
    const input = SharedByteRing.allocate(262144),
      audio = new Sink()
    let ready = 0
    for (let n = 0; n < 90; n++) put(input, frame())
    const core = new Core({
      input: input.buffers,
      mode: 'finite',
      seekSeconds: 1,
      audio: { out: audio },
      onReady: (value) => {
        if (value) ready++
      },
    })
    core.source({ offset: 1000, seconds: 0, estimated: true })
    for (let n = 0; n < 4; n++) core.pump()
    equal(ready, 0, 'preroll must not discard the approximate resume safety buffer')
    equal(audio.frames, 0)
    for (let n = 0; n < 160; n++) put(input, frame())
    core.pump()
    equal(ready, 1, 'sufficient compressed data allows playback before EOF')
    assert(audio.frames > 0)
    core.close()
  }
  {
    const input = SharedByteRing.allocate(131072),
      audio = new Sink()
    for (let n = 0; n < 90; n++) put(input, frame())
    const variable = new Uint8Array(522)
    variable.set([255, 251, 0xa0, 0])
    put(input, variable)
    for (let n = 0; n < 50; n++) put(input, frame())
    let invalid = 0
    const core = new Core({
      input: input.buffers,
      mode: 'finite',
      seekSeconds: 120,
      audio: { out: audio },
      onSeekInvalid: () => invalid++,
    })
    core.source({
      offset: 1000000,
      seconds: 118,
      estimated: true,
      synchronize: true,
      cbr: { offset: 0, bitRate: 128000, sampleRate: 44100, version: 3, layer: 1 },
    })
    core.end()
    for (let n = 0; n < 4; n++) core.pump()
    equal(invalid, 1, 'CBR mismatch in pending PCM still falls back before playback starts')
    equal(audio.frames, 0)
    core.close()
  }
  {
    const input = SharedByteRing.allocate(262144),
      audio = new Sink(),
      hints = []
    for (let n = 0; n < 240; n++) put(input, frame())
    let invalid = 0
    const core = new Core({
      input: input.buffers,
      mode: 'finite',
      audio: { out: audio },
      onSeekInfo: (value) => hints.push(value),
      onSeekInvalid: () => invalid++,
    })
    core.source({
      offset: 1000,
      seconds: 0,
      estimated: true,
      synchronize: true,
      cbr: { offset: 0, bitRate: 128000, sampleRate: 44100, version: 3, layer: 1 },
    })
    for (let n = 0; n < 4; n++) {
      core.pump()
      audio.complete()
    }
    const played = audio.samples
    assert(played > 0, 'approximate playback starts before the format changes')
    const variable = new Uint8Array(522)
    variable.set([255, 251, 0xa0, 0])
    put(input, variable)
    core.end()
    for (let n = 0; n < 8; n++) {
      core.pump()
      audio.complete()
    }
    equal(hints.at(-1), null)
    equal(invalid, 0, 'an approximate jump must not restart after PCM playback starts')
    assert(audio.samples > played, 'playback continues through the format change')
    core.close()
  }
  // Output completion is later than PCM consumption, and cancellation rejects drain.
  trace('media: output completion\n')
  {
    const lease = await runtime.acquirePlayback(runtime.speaker, [mono(24000)], {
      ...createVoiceScope(),
      budget: { maxBufferedMs: 250, maxBufferedBytes: 24576 },
    })
    const audio = new AudioOut(lease, (error) => {
      throw error
    })
    const output = SharedByteRing.allocate(16384)
    const completion = new Int32Array(new SharedArrayBuffer(4))
    const pcm = Uint8Array.from({ length: 12006 }, (_, index) => index % 251)
    put(output, pcm)
    audio.attachSharedOutput(output, completion, () => {})
    audio.start()
    const driver = outputs.at(-1)
    equal(Atomics.load(completion, 0), 10240, 'return only the prefix accepted by DMA')
    equal(output.readableBytes, pcm.length - 10240, 'the decoder cannot reuse a pending tail')
    equal(audio.playedSeconds, 0, 'queued PCM is not played PCM')
    driver.writable(10240)
    await settle()
    equal(output.readableBytes, 0)
    equal(Atomics.load(completion, 0), pcm.length)
    equal(driver.writes[1][0], pcm[10240], 'a resumed write starts at the first unaccepted byte')
    let drained = false
    const promise = audio.drain().then(() => {
      drained = true
    })
    await Promise.resolve()
    assert(!drained)
    await drainDriver(driver)
    await promise
    assert(drained)
    equal(audio.playedSeconds, pcm.length / 48000, 'drain padding is not progress')
    await audio.close()
  }
  // Actual worker entry point and resampler run in XS with message and DMA boundaries controlled.
  trace('media: worker entry\n')
  {
    const messages = []
    globalThis.self = { postMessage: (message) => messages.push(message), close() {} }
    await import('web-radio-stream-worker')
    const input = SharedByteRing.allocate(8192),
      output = SharedByteRing.allocate(65536)
    const completion = new Int32Array(new SharedArrayBuffer(4))
    put(input, frame(48000))
    self.onmessage({
      id: 'start',
      queueLength: 48,
      sampleRate: 44100,
      outputSampleRate: 24000,
      input: input.buffers,
      output: output.buffers,
      completion,
    })
    self.onmessage({ id: 'end' })
    let consumed = 0
    for (let n = 0; n < 8; n++) {
      Timer.advance(25)
      const available = output.readableBytes
      consumed += available
      output.advanceRead(available)
      Atomics.add(completion, 0, available)
    }
    equal(consumed, 1152, '1152 samples at 48 kHz produce 576 samples at 24 kHz including the held tail')
    equal(messages.filter((message) => message.id === 'done').length, 1)
    self.onmessage({ id: 'close' })
  }
  // Public finite mode never retries and waits for hardware drain before ended.
  trace('media: finite playback\n')
  {
    const player = new MediaPlayer(getSpeaker),
      states = []
    await player.start({
      url: 'http://example.test/episode',
      mode: 'finite',
      onStateChanged: (state) => states.push(state),
    })
    tick()
    const worker = workers[workers.length - 1]
    const config = worker.messages[0]
    worker.send({ id: 'ready', value: true })
    const output = new SharedByteRing(config.output.data, config.output.state)
    put(output, new Uint8Array([1, 2, 3, 4, 5, 6]))
    worker.send({ id: 'output' })
    lastClient().headers(200, { 'content-length': '0' })
    lastClient().done()
    assert(worker.messages.some((message) => message.id === 'end'))
    worker.send({ id: 'done' })
    await Promise.resolve()
    assert(player.state !== 'ended')
    const driver = outputs[outputs.length - 1]
    await drainDriver(driver)
    equal(player.state, 'ended')
    equal(states.filter((state) => state === 'ended').length, 1)
    await player.stop()
    worker.send({ id: 'done' })
    equal(player.state, 'idle')
  }
  // Pause retains consumed position and source identity; resume uses a frame checkpoint + preroll.
  trace('media: pause and resume\n')
  {
    const player = new MediaPlayer(getSpeaker)
    await player.start({ url: 'https://example.test/audio', mode: 'finite', duration: 100 })
    tick()
    let worker = workers.at(-1)
    lastClient().headers(302, { location: 'https://cdn.test/signed-old' })
    tick()
    lastClient().headers(200, { 'content-length': '100000', etag: '"episode"' })
    worker.send({ id: 'checkpoint', value: { offset: 1000, seconds: 10 } })
    worker.send({ id: 'position', seconds: 12 })
    worker.send({ id: 'ready', value: true })
    const output = new SharedByteRing(worker.messages[0].output.data, worker.messages[0].output.state)
    put(output, new Uint8Array(4096))
    worker.send({ id: 'output' })
    equal(player.progress.position, 12)
    outputs.at(-1).writable(10240)
    const position = player.progress.position
    assert(position > 12)
    player.pause()
    equal(player.state, 'paused')
    equal(player.progress.position, position)
    assert(lastClient().closed)
    const count = workers.length
    await player.seek(30)
    equal(workers.length, count, 'seeking while paused does not start playback')
    equal(player.progress.position, 30)
    await player.resume()
    tick()
    worker = workers.at(-1)
    equal(worker.messages[0].seekSeconds, 30)
    equal(lastClient().options.host, 'example.test', 'resume starts from the original enclosure URL')
    equal(lastClient().callbacks.path, '/audio')
    lastClient().headers(302, { location: 'https://cdn.test/signed-new' })
    tick()
    equal(lastClient().callbacks.path, '/signed-new', 'resume obtains a fresh signed CDN URL')
    equal(lastClient().callbacks.headers.get('range'), 'bytes=1000-')
    equal(lastClient().callbacks.headers.get('if-range'), '"episode"')
    lastClient().headers(206, { 'content-length': '99000', 'content-range': 'bytes 1000-99999/100000' })
    equal(worker.messages.find((message) => message.id === 'source').seconds, 10)
    await player.stop()
    worker.send({ id: 'position', seconds: 30 })
    equal(player.progress.position, 0, 'stale worker cannot update stopped progress')
  }
  const cbr = { offset: 34, bitRate: 128000, sampleRate: 44100, version: 3, layer: 1 }
  const totalBytes = 4587136
  async function approximateSession(accuracy = 'approximate') {
    const player = new MediaPlayer(getSpeaker)
    await player.start({
      url: 'https://example.test/audio',
      mode: 'finite',
      duration: 280,
      ...(accuracy === 'default' ? {} : { seekAccuracy: accuracy }),
    })
    tick()
    const worker = workers.at(-1)
    lastClient().headers(200, { 'content-length': String(totalBytes), etag: '"episode"' })
    worker.send({ id: 'seek-info', value: cbr })
    worker.send({ id: 'checkpoint', value: { offset: 160530, seconds: 10 } })
    player.pause()
    await player.seek(120)
    await player.resume()
    tick()
    return player
  }
  for (const accuracy of ['default', 'exact', 'approximate']) {
    const player = await approximateSession(accuracy)
    const worker = workers.at(-1)
    const offset = Number(lastClient().callbacks.headers.get('range').slice(6, -1))
    if (accuracy !== 'approximate') {
      equal(offset, 160530, 'exact remains the default frame-index path')
      assert(!player.progress.positionEstimated)
    } else {
      assert(offset > 1800000, 'an unvisited distant position avoids downloading the full prefix')
      assert(offset < (120 * 128000) / 8, 'range includes decoder preroll')
      assert(player.progress.positionEstimated)
    }
    lastClient().headers(206, {
      'content-length': String(totalBytes - offset),
      'content-range': `bytes ${offset}-${totalBytes - 1}/${totalBytes}`,
      etag: '"episode"',
    })
    const source = worker.messages.find((message) => message.id === 'source')
    equal(source.estimated, accuracy === 'approximate')
    equal(source.synchronize, accuracy === 'approximate')
    assert(source.cbr, 'exact checkpoint resumes must continue checking the observed CBR candidate')
    if (accuracy === 'approximate') {
      const observed = offset + 10000
      worker.send({ id: 'checkpoint', value: { offset: observed, seconds: 123, estimated: true } })
      worker.send({ id: 'position', seconds: 125, estimated: true })
      worker.send({ id: 'seek-info', value: null })
      player.pause()
      await player.resume()
      tick()
      equal(
        lastClient().callbacks.headers.get('range'),
        `bytes=${observed}-`,
        'resume preserves the observed approximate time domain after CBR rejection',
      )
      assert(player.progress.positionEstimated)
      player.pause()
      await player.seek(60)
      await player.resume()
      tick()
      equal(
        lastClient().callbacks.headers.get('range'),
        'bytes=160530-',
        'an explicit later seek uses the exact index after rejection',
      )
      assert(!player.progress.positionEstimated)
    }
    await player.stop()
  }
  for (const action of ['fallback', 'stop', 'ignored', 'changed']) {
    const player = await approximateSession()
    const worker = workers.at(-1),
      client = lastClient(),
      count = workers.length
    if (action === 'ignored') {
      client.headers(200, { 'content-length': String(totalBytes), etag: '"episode"' })
      const source = worker.messages.find((message) => message.id === 'source')
      equal(source.seconds, 0)
      equal(source.estimated, false)
      equal(source.synchronize, false)
      assert(!player.progress.positionEstimated)
    } else if (action === 'changed') {
      const offset = Number(client.callbacks.headers.get('range').slice(6, -1))
      client.headers(206, {
        'content-length': String(totalBytes - offset),
        'content-range': `bytes ${offset}-${totalBytes - 1}/${totalBytes}`,
        etag: '"replacement"',
      })
      equal(player.state, 'error', 'same-sized replacement cannot reuse a seek anchor')
    } else {
      worker.send({ id: 'seek-invalid' })
      if (action === 'stop') await player.stop()
      await settle()
      tick()
      if (action === 'stop') equal(workers.length, count, 'stop cancels a pending exact fallback')
      else {
        equal(workers.length, count + 1)
        equal(
          lastClient().callbacks.headers.get('range'),
          'bytes=160530-',
          'failed synchronization retries from a verified checkpoint',
        )
        assert(!player.progress.positionEstimated)
      }
    }
    await player.stop()
  }
  // Unvalidated bytes cannot anchor a later seek, including after a validator appears.
  for (const headers of [{}, { etag: 'W/"episode"' }]) {
    const player = new MediaPlayer(getSpeaker)
    await player.start({ url: 'https://example.test/audio', mode: 'finite', duration: 100 })
    tick()
    lastClient().headers(200, { 'content-length': '100000', ...headers })
    workers.at(-1).send({ id: 'checkpoint', value: { offset: 1000, seconds: 10 } })
    player.pause()
    await player.seek(30)
    await player.resume()
    tick()
    let worker = workers.at(-1)
    equal(worker.messages[0].seekSeconds, 30, 'scan still targets the requested playback time')
    assert(!lastClient().callbacks.headers.has('range'), 'without a validator, read from byte zero')
    assert(!lastClient().callbacks.headers.has('if-range'))
    lastClient().headers(200, { 'content-length': '100000', etag: '"replacement"' })
    const source = worker.messages.find((message) => message.id === 'source')
    equal(source.offset, 0)
    equal(source.seconds, 0, 'replacement content has no old checkpoint time anchor')
    worker.send({ id: 'checkpoint', value: { offset: 2000, seconds: 10 } })
    player.pause()
    await player.seek(30)
    await player.resume()
    tick()
    worker = workers.at(-1)
    equal(worker.messages[0].seekSeconds, 30)
    equal(lastClient().callbacks.headers.get('range'), 'bytes=2000-', 'only the replacement checkpoint is reused')
    equal(lastClient().callbacks.headers.get('if-range'), '"replacement"')
    await player.stop()
  }
  // A live decoder failure restarts at current audio, even after a long listening session.
  {
    const player = new MediaPlayer(getSpeaker)
    await player.start({ url: 'http://example.test/live', mode: 'live' })
    tick()
    const worker = workers.at(-1)
    worker.send({ id: 'ready', value: true })
    put(new SharedByteRing(worker.messages[0].output.data, worker.messages[0].output.state), new Uint8Array(4096))
    worker.send({ id: 'output' })
    outputs.at(-1).writable(10240)
    assert(player.progress.position > 0, 'audio was consumed before the failure')
    worker.send({ id: 'error', reason: 'decoder failed' })
    equal(player.state, 'retrying')
    Timer.advance(1000)
    await settle()
    const replacement = workers.at(-1)
    assert(replacement !== worker, 'recovery opens a fresh decoder session')
    equal(replacement.messages[0].seekSeconds, 0, 'live reconnect must not discard previously played time')
    await player.stop()
  }
  // HTTP retries retain the decoder and both rings while notifying the public session.
  {
    const player = new MediaPlayer(getSpeaker)
    const states = []
    const session = await player.open(
      { url: 'http://example.test/live', mode: 'live' },
      { ...createVoiceScope(), onStateChanged: (state, reason) => states.push({ state, reason }) },
    )
    tick()
    const worker = workers.at(-1)
    const workerCount = workers.length
    const config = worker.messages[0]
    const input = new SharedByteRing(config.input.data, config.input.state)
    const output = new SharedByteRing(config.output.data, config.output.state)
    lastClient().headers(503)
    equal(session.state, 'retrying')
    assert(states.at(-1).reason.includes('503'))
    worker.send({ id: 'ready', value: true })
    equal(session.state, 'retrying', 'decoder readiness cannot hide a pending HTTP retry')
    Timer.advance(250)
    const connected = lastClient()
    connected.headers(200, { 'transfer-encoding': 'chunked' })
    equal(session.state, 'buffering')
    put(output, new Uint8Array(4096))
    worker.send({ id: 'output' })
    equal(session.state, 'playing')
    const driver = outputs.at(-1)
    connected.data(frame())
    const buffered = input.readableBytes
    assert(buffered > 0)
    connected.done(new Error('network lost'))
    equal(session.state, 'retrying')
    put(output, new Uint8Array(4096))
    worker.send({ id: 'output' })
    equal(session.state, 'retrying', 'buffered audio may play while the transport reconnects')
    worker.send({ id: 'ready', value: false })
    equal(session.state, 'retrying')
    Timer.advance(250)
    lastClient().headers(200, { 'transfer-encoding': 'chunked' })
    equal(session.state, 'stalled', 'connection recovery still waits for PCM after underrun')
    equal(input.readableBytes, buffered, 'HTTP recovery preserves compressed input')
    equal(workers.length, workerCount, 'HTTP recovery keeps the existing decoder')
    equal(outputs.at(-1), driver, 'HTTP recovery keeps the speaker')
    worker.send({ id: 'ready', value: true })
    put(output, new Uint8Array(1024))
    worker.send({ id: 'output' })
    equal(session.state, 'playing')
    equal(states.filter(({ state }) => state === 'retrying').length, 2)
    await session.stop()
    equal(await session.done, 'stopped')
  }
  {
    const player = new MediaPlayer(getSpeaker)
    let stopping
    const session = await player.open(
      { url: 'http://example.test/live', mode: 'live' },
      {
        ...createVoiceScope(),
        onStateChanged: (state) => {
          if (state === 'retrying') stopping = session.stop()
        },
      },
    )
    tick()
    const count = clients.length
    lastClient().headers(503)
    await stopping
    Timer.advance(30000)
    equal(clients.length, count, 'stop inside retry notification cancels the scheduled connection')
    equal(await session.done, 'stopped')
  }
  // Replacing playback from a state callback opens only the replacement session.
  {
    const player = new MediaPlayer(getSpeaker)
    const before = workers.length
    await player.start({
      url: 'http://example.test/old',
      mode: 'finite',
      onStateChanged: (state) => {
        if (state === 'connecting') void player.start({ url: 'http://example.test/new', mode: 'finite' })
      },
    })
    tick()
    await settle()
    tick()
    equal(workers.length, before + 1)
    equal(lastClient().callbacks.path, '/new')
    await player.stop()
  }
  // Finite failures never reconnect; live streams retain their reconnect behavior.
  for (const mode of ['finite', 'live']) {
    const player = new MediaPlayer(getSpeaker)
    await player.start({ url: 'http://example.test/episode', mode })
    tick()
    const failedClient = lastClient()
    const before = clients.length
    failedClient.done(new Error('network lost'))
    if (mode === 'finite') {
      equal(player.state, 'error')
      Timer.advance(30000)
      equal(clients.length, before)
    } else {
      Timer.advance(250)
      assert(clients.length > before, 'live connection must reconnect')
    }
    await player.stop()
    const stoppedCount = clients.length
    Timer.advance(30000)
    equal(clients.length, stoppedCount, 'stop must cancel reconnect')
  }
  // Stop during hardware drain cancels ended, even if the old output later reports completion.
  {
    const player = new MediaPlayer(getSpeaker)
    const states = []
    await player.start({
      url: 'http://example.test/episode',
      mode: 'finite',
      onStateChanged: (state) => states.push(state),
    })
    tick()
    const worker = workers.at(-1)
    worker.send({ id: 'ready', value: true })
    put(new SharedByteRing(worker.messages[0].output.data, worker.messages[0].output.state), new Uint8Array(6))
    worker.send({ id: 'output' })
    worker.send({ id: 'done' })
    const driver = outputs.at(-1)
    await player.stop()
    driver.writable(16)
    await Promise.resolve()
    await Promise.resolve()
    equal(player.state, 'idle')
    assert(!states.includes('ended'), 'stopped drain cannot end a session')
  }
  // Worker lifetime: release on success, failure, cancellation and missing reply.
  {
    let instance
    class RSSWorker {
      constructor() {
        instance = this
        this.terminations = 0
      }
      postMessage(message) {
        this.message = message
      }
      terminate() {
        this.terminations++
      }
    }
    const success = loadWorkerFeed('https://example.test/rss', RSSWorker)
    equal(instance.message.url, 'https://example.test/rss')
    const result = { title: 'show', episodes: [] }
    instance.onmessage({ result })
    equal(await success.promise, result)
    equal(instance.terminations, 1)
    success.cancel()
    equal(instance.terminations, 1)
    for (const mode of ['error', 'cancel', 'timeout']) {
      const request = loadWorkerFeed('https://example.test/rss', RSSWorker)
      const rejected = request.promise.then(
        () => false,
        () => true,
      )
      if (mode === 'error') instance.onmessage({ error: 'bad XML' })
      else if (mode === 'cancel') request.cancel()
      else Timer.advance(35_000)
      assert(await rejected)
      equal(instance.terminations, 1)
      instance.onmessage({ result })
      equal(instance.terminations, 1, 'late reply cannot resurrect a settled request')
    }
  }
  // RSS retrieval resolves bounded complete items and rejects explicit cancellation.
  trace('media: RSS retrieval\n')
  {
    const feed = loadFeed('https://example.test/rss')
    tick()
    const xml = ArrayBuffer.fromString(
      '<rss version="2.0"><channel><title>Podcast</title><description>' +
        'x'.repeat(9000) +
        '</description><item><title>one</title><guid>one</guid><enclosure type="audio/mpeg" url="/one.mp3"/></item></channel></rss>',
    )
    lastClient().headers(200, { 'content-length': String(xml.byteLength) })
    const rssClient = lastClient()
    rssClient.data(new Uint8Array(xml))
    equal(rssClient.offset, 0, 'network callback yields before parsing RSS')
    Timer.advance(10)
    assert(rssClient.offset > 0 && rssClient.offset < xml.byteLength, 'parsing yields with buffered bytes remaining')
    let uiTicks = 0
    const uiTimer = Timer.repeat(() => uiTicks++, 10)
    while (rssClient.offset < xml.byteLength) Timer.advance(10)
    Timer.clear(uiTimer)
    assert(uiTicks > 0, 'UI timers run between RSS parsing turns')
    rssClient.done()
    const result = await feed.promise
    equal(result.episodes[0].url, 'https://example.test/one.mp3')
    const cancel = loadFeed('https://example.test/rss')
    const rejected = cancel.promise.then(
      () => false,
      () => true,
    )
    tick()
    const cancelledClient = lastClient()
    cancelledClient.headers(200, { 'content-length': String(xml.byteLength) })
    cancelledClient.data(new Uint8Array(xml))
    cancel.cancel()
    Timer.advance(100)
    equal(cancelledClient.offset, 0, 'cancellation removes deferred RSS work')
    assert(await rejected)
  }
  // Mini app actions exercise the MOD controller, including late responses and TTS stop.
  trace('media: controller\n')
  {
    const buttons = new Map(),
      balloons = [],
      loads = [],
      starts = []
    let stopped = 0,
      notes = false,
      motion = true,
      indicator = false
    const context = {
      audio: {
        media: {
          open: async (source, options) => {
            starts.push({ ...source, ...options })
            options.signal.addEventListener('abort', () => {
              stopped++
            })
            return { stop: async () => {}, pause: async () => {}, resume: async () => {}, seek: async () => {} }
          },
          stop: () => {
            stopped++
          },
        },
      },
      connectivity: { network: { ready: Promise.resolve({ status: 'connected' }) } },
      drawer: {
        addDrawerButton: (button) => buttons.set(button.key, button),
        removeDrawerButton: (key) => buttons.delete(key),
      },
      ui: {
        setFaceMotionEnabled: (enabled) => {
          motion = enabled
        },
        application: {
          distribute: (_event, enabled) => {
            indicator = enabled
          },
        },
      },
      showBalloon: (text) => balloons.push(text),
    }
    const load = () => {
      let resolve
      const request = {
        promise: new Promise((done) => {
          resolve = done
        }),
        cancel() {
          this.cancelled = true
        },
      }
      loads.push({ request, resolve })
      return request
    }
    const controller = new PodcastController(
      context,
      [
        { title: 'A', url: 'https://a/' },
        { title: 'B', url: 'https://b/' },
      ],
      load,
      {
        show: () => {
          notes = true
        },
        hide: () => {
          notes = false
        },
      },
      undefined,
      [],
      createVoiceScope,
    )
    const snapshots = []
    const unsubscribe = controller.subscribe((state) => snapshots.push(state))
    const initial = controller.start()
    await Promise.resolve()
    const second = controller.selectFeed(1)
    assert(loads[0].request.cancelled)
    loads[0].resolve({ title: 'stale', episodes: [{ identity: 'old', title: 'old', url: 'https://old/' }] })
    await initial
    equal(controller.snapshot.episodes.length, 0)
    loads[1].resolve({ title: 'B', episodes: [{ identity: 'new', title: 'new', url: 'https://new/' }] })
    await second
    equal(starts.length, 0, 'listing must not autoplay')
    await controller.play()
    equal(starts[0].mode, 'finite')
    equal(starts[0].url, 'https://new/')
    starts[0].onStateChanged('playing')
    assert(notes)
    assert(!motion)
    unsubscribe()
    starts[0].onProgress({ position: 20, duration: 100, estimated: false, seekable: true })
    assert(notes, 'unmounting view leaves face effects running')
    equal(controller.snapshot.progress.position, 20)
    starts[0].onStateChanged('paused')
    assert(!notes)
    assert(motion)
    starts[0].onStateChanged('playing')
    assert(notes)
    assert(!motion, 'resume restores playback face mode')
    const unsubscribeAgain = controller.subscribe((state) => snapshots.push(state))
    starts[0].onStateChanged('idle')
    assert(!notes)
    assert(motion)
    assert(!indicator)
    await controller.play()
    starts[1].onStateChanged('ended')
    assert(motion)
    assert(!notes)
    controller.stop()
    starts[0].onStateChanged('playing')
    assert(!notes, 'stale playback cannot restore notes')
    assert(stopped > 0)
    assert(
      snapshots.some((state) => state.loading),
      'loading state reaches mini app',
    )
    assert(
      snapshots.some((state) => state.state === 'ended'),
      'completion reaches mini app',
    )
    unsubscribe()
    unsubscribeAgain()
    const count = snapshots.length
    controller.close()
    equal(snapshots.length, count, 'unmounted view gets no notifications')
    equal(buttons.size, 0, 'mini app does not install drawer controls')
  }
  Timer.reset()
  trace('@@STACKCHAN_TEST:PASS@@\n')
}
runTests().catch((error) => {
  trace('@@STACKCHAN_TEST:FAIL@@\n')
  trace(`unhandled exception in media tests: ${error.message}\n${error.stack}\n`)
  throw error
})
