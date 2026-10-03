import 'podcast-rss-tests'
import { outputs } from 'embedded:io/audio/out'
import Core from 'buffered-mp3streamer-core'
import MediaHttpStream from 'media-http'
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
  // Output completion is later than PCM consumption, and cancellation rejects drain.
  {
    const audio = new AudioOut({}),
      output = SharedByteRing.allocate(32),
      completion = new Int32Array(new SharedArrayBuffer(4))
    put(output, new Uint8Array([1, 2, 3, 4, 5, 6]))
    audio.attachSharedOutput(output, completion, () => {})
    audio.start()
    equal(Atomics.load(completion, 0), 6)
    equal(audio.playedSeconds, 0, 'queued PCM is not played PCM')
    let drained = false
    const promise = audio.drain().then(() => {
      drained = true
    })
    await Promise.resolve()
    assert(!drained)
    const driver = outputs[outputs.length - 1]
    driver.writable(8)
    driver.writable(8)
    await Promise.resolve()
    assert(!drained)
    driver.writable(16)
    await promise
    assert(drained)
    equal(audio.playedSeconds, 6 / 48000, 'drain padding is not progress')
    const cancelled = audio.drain().then(
      () => false,
      () => true,
    )
    audio.stop()
    assert(await cancelled)
    audio.close()
  }
  // Actual worker entry point and resampler run in XS with message and DMA boundaries controlled.
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
  {
    const player = new MediaPlayer(),
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
    driver.writable(8)
    driver.writable(8)
    driver.writable(16)
    await Promise.resolve()
    await Promise.resolve()
    equal(player.state, 'ended')
    equal(states.filter((state) => state === 'ended').length, 1)
    player.stop()
    worker.send({ id: 'done' })
    equal(player.state, 'idle')
  }
  // Pause retains consumed position and source identity; resume uses a frame checkpoint + preroll.
  {
    const player = new MediaPlayer()
    await player.start({ url: 'https://example.test/audio', mode: 'finite', duration: 100 })
    tick()
    let worker = workers.at(-1)
    lastClient().headers(200, { 'content-length': '100000', etag: '"episode"' })
    worker.send({ id: 'checkpoint', value: { offset: 1000, seconds: 10 } })
    worker.send({ id: 'position', seconds: 12 })
    worker.send({ id: 'ready', value: true })
    const output = new SharedByteRing(worker.messages[0].output.data, worker.messages[0].output.state)
    put(output, new Uint8Array(16))
    worker.send({ id: 'output' })
    equal(player.progress.position, 12)
    outputs.at(-1).writable(16)
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
    equal(lastClient().callbacks.headers.get('range'), 'bytes=1000-')
    equal(lastClient().callbacks.headers.get('if-range'), '"episode"')
    lastClient().headers(206, { 'content-length': '99000', 'content-range': 'bytes 1000-99999/100000' })
    equal(worker.messages.find((message) => message.id === 'source').seconds, 10)
    player.stop()
    worker.send({ id: 'position', seconds: 30 })
    equal(player.progress.position, 0, 'stale worker cannot update stopped progress')
  }
  // Replacing playback from a state callback opens only the replacement session.
  {
    const player = new MediaPlayer()
    const before = workers.length
    await player.start({
      url: 'http://example.test/old',
      mode: 'finite',
      onStateChanged: (state) => {
        if (state === 'connecting') void player.start({ url: 'http://example.test/new', mode: 'finite' })
      },
    })
    tick()
    equal(workers.length, before + 1)
    equal(lastClient().callbacks.path, '/new')
    player.stop()
  }
  // Finite failures never reconnect; live streams retain their reconnect behavior.
  for (const mode of ['finite', 'live']) {
    const player = new MediaPlayer()
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
    player.stop()
    const stoppedCount = clients.length
    Timer.advance(30000)
    equal(clients.length, stoppedCount, 'stop must cancel reconnect')
  }
  // Stop during hardware drain cancels ended, even if the old output later reports completion.
  {
    const player = new MediaPlayer()
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
    player.stop()
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
          start: async (options) => {
            starts.push(options)
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
  trace('ok\n')
}
runTests().catch((error) => {
  trace(`media tests failed: ${error.message}\n${error.stack}\n`)
  throw error
})
