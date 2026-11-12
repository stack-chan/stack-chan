import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { test } from 'node:test'
import type { Synthesis, TTS } from '../contracts.js'
import { createVoiceScope, deferred, voiceError } from '../scope.js'

const aliases: Record<string, string> = {
  'stackchan/voice/media': '../media.js',
  'stackchan/voice/scope': '../scope.js',
}
const hooks = registerHooks({
  resolve(specifier, context, next) {
    return aliases[specifier]
      ? { shortCircuit: true, url: new URL(aliases[specifier], import.meta.url).href }
      : next(specifier, context)
  },
})
const { openStreamingSynthesis } = await import('../synthesis.js')
const { createPcmSink, createPcmSource, mono, pcmMedia, readSource } = await import('../media.js')
hooks.deregister()

const turn = () => new Promise<void>((resolve) => setImmediate(resolve))
const format = mono(24000)
const budget = { maxBufferedMs: 100, maxBufferedBytes: 4096 }

function renderer(known = true) {
  const segments: { text: string; closed: number; started: boolean; block: Uint8Array }[] = []
  let nextOpen: Promise<void> | undefined
  let nextClose: Promise<void> | undefined
  async function open({ signal }: Parameters<TTS['open']>[0]): Promise<Omit<Synthesis, 'flush'>> {
    const source = createPcmSource(format)
    const state = { text: '', closed: 0, started: false, block: Uint8Array.of(1, 0, 2, 0) }
    segments.push(state)
    const openGate = nextOpen
    const closeGate = nextClose
    nextOpen = nextClose = undefined
    let completion: ReturnType<typeof deferred<void>> | undefined
    let completed = false
    const abort = () => {
      source.end(signal.reason)
      completion?.reject(signal.reason)
    }
    signal.addEventListener('abort', abort)
    const segment: Omit<Synthesis, 'flush'> = {
      output: source.output,
      async write(part) {
        state.text += part
      },
      finish() {
        if (completion) return completion.promise
        completion = deferred<void>()
        state.started = true
        void (async () => {
          await source.offer(state.block)
          if (signal.aborted) throw signal.reason
          completed = true
          source.end()
        })().then(completion.resolve, completion.reject)
        return completion.promise
      },
      textAt(position) {
        return known && completed && position.basis !== 'unknown' && position.renderedFrames >= 2
          ? { text: state.text, basis: 'completed-segment' }
          : { text: '', basis: 'unknown' }
      },
      async close() {
        state.closed++
        signal.removeEventListener('abort', abort)
        source.end()
        completion?.reject(voiceError('cancelled'))
        await closeGate
      },
    }
    await openGate
    return segment
  }
  return {
    open,
    segments,
    gateNext(openGate: Promise<void>, closeGate?: Promise<void>) {
      nextOpen = openGate
      nextClose = closeGate
    },
  }
}

test('flush transfers PCM by reference with backpressure and keeps one output open across segments', async () => {
  const native = renderer()
  const scope = createVoiceScope()
  const synthesis = await openStreamingSynthesis({ ...scope, format, voice: '' }, native.open, 512)
  const output = synthesis.output
  const accepted = deferred<void>()
  const blocks: Uint8Array[] = []
  const link = await pcmMedia.connect(
    output,
    createPcmSink(format, (bytes) => {
      blocks.push(bytes)
      if (blocks.length === 1) return accepted.promise
    }),
    { ...scope, budget },
  )
  let ended = false
  void link.done.then(() => {
    ended = true
  })
  await synthesis.write('first')
  let flushed = false
  const flush = synthesis.flush().then(() => {
    flushed = true
  })
  await turn()
  assert.equal(flushed, false)
  assert.equal(blocks[0], native.segments[0].block)
  await assert.rejects(synthesis.write('conflict'), { code: 'device_busy' })
  await assert.rejects(synthesis.flush(), { code: 'device_busy' })
  accepted.resolve()
  await flush
  assert.equal(ended, false)
  assert.equal(native.segments[0].closed, 1)
  const cursor = { basis: 'device-clock' as const, sampleRate: 48000, renderedFrames: 4 }
  assert.deepEqual(synthesis.textAt(cursor), { basis: 'completed-segment', text: 'first' })
  await synthesis.write('second')
  await synthesis.finish()
  await link.done
  assert.equal(synthesis.output, output)
  assert.deepEqual(
    native.segments.map((segment) => segment.text),
    ['first', 'second'],
  )
  assert.equal(blocks[1], native.segments[1].block)
  assert.deepEqual(synthesis.textAt({ ...cursor, renderedFrames: 7 }), {
    basis: 'completed-segment',
    text: 'first',
  })
  assert.deepEqual(synthesis.textAt({ ...cursor, renderedFrames: 8 }), {
    basis: 'completed-segment',
    text: 'firstsecond',
  })
  await synthesis.close()
})

test('finish joins a pending flush once and closes input before PCM acceptance', async () => {
  const native = renderer()
  const scope = createVoiceScope()
  const synthesis = await openStreamingSynthesis({ ...scope, format, voice: '' }, native.open, 512)
  const accepted = deferred<void>()
  readSource(synthesis.output, () => accepted.promise)
  await synthesis.write('one')
  const flushing = synthesis.flush()
  const finish = synthesis.finish()
  assert.equal(synthesis.finish(), finish)
  await assert.rejects(synthesis.write('two'), { code: 'cancelled' })
  let finished = false
  void finish.then(() => {
    finished = true
  })
  await turn()
  assert.equal(finished, false)
  accepted.resolve()
  await Promise.all([flushing, finish])
  assert.equal(native.segments.length, 1)
  assert.equal(native.segments[0].closed, 1)
})

test('finish is memoized before a PCM consumer can reenter it', async () => {
  const native = renderer()
  const synthesis = await openStreamingSynthesis({ ...createVoiceScope(), format, voice: '' }, native.open, 512)
  let reentered: Promise<void> | undefined
  readSource(synthesis.output, () => {
    reentered = synthesis.finish()
  })
  await synthesis.write('one')
  const finish = synthesis.finish()
  assert.equal(reentered, finish)
  await finish
  assert.equal(native.segments.length, 1)
})

test('failed resource release rejects finish and retains provider ownership', async () => {
  const native = renderer()
  const failure = new Error('native release failed')
  let releases = 0
  const synthesis = await openStreamingSynthesis(
    { ...createVoiceScope(), format, voice: '' },
    async (options) => ({
      ...(await native.open(options)),
      async close() {
        throw failure
      },
    }),
    512,
    () => {
      releases++
    },
  )
  await synthesis.write('one')
  const finish = synthesis.finish()
  await assert.rejects(finish, failure)
  assert.equal(synthesis.finish(), finish)
  await assert.rejects(synthesis.close(), failure)
  assert.equal(releases, 0)
})

test('close aborts blocked PCM and awaits a late-opened segment and its resource release', async () => {
  const native = renderer()
  const scope = createVoiceScope()
  let releases = 0
  const synthesis = await openStreamingSynthesis({ ...scope, format, voice: '' }, native.open, 512, () => {
    releases++
  })
  await synthesis.write('one')
  await synthesis.flush()
  const opened = deferred<void>()
  const released = deferred<void>()
  native.gateNext(opened.promise, released.promise)
  const writing = synthesis.write('two')
  const writingRejected = assert.rejects(writing, { code: 'cancelled' })
  let closed = false
  const closing = synthesis.close().then(() => {
    closed = true
  })
  await turn()
  assert.equal(closed, false)
  opened.resolve()
  await turn()
  assert.equal(native.segments[1].closed, 1)
  assert.equal(closed, false)
  assert.equal(native.segments[1].started, false)
  released.resolve()
  await Promise.all([closing, writingRejected])
  assert.equal(releases, 1)
  await synthesis.close()
  assert.equal(releases, 1)

  const blocked = await openStreamingSynthesis({ ...createVoiceScope(), format, voice: '' }, native.open, 512)
  const accepted = deferred<void>()
  readSource(blocked.output, () => accepted.promise)
  await blocked.write('three')
  const flushing = assert.rejects(blocked.flush(), { code: 'cancelled' })
  await blocked.close()
  await flushing
  assert.equal(native.segments.at(-1)?.closed, 1)
  accepted.resolve()
  await turn()
})

test('text progress remains unknown when the renderer cannot establish completed text', async () => {
  const native = renderer(false)
  const synthesis = await openStreamingSynthesis({ ...createVoiceScope(), format, voice: '' }, native.open, 512)
  await synthesis.write('one')
  await synthesis.flush()
  await synthesis.write('two')
  await synthesis.finish()
  assert.deepEqual(synthesis.textAt({ basis: 'estimate', renderedFrames: 100, sampleRate: 24000 }), {
    text: '',
    basis: 'unknown',
  })
})

test('bounded text and segment counts reject additional input without queuing synthesis', async () => {
  const native = renderer()
  const synthesis = await openStreamingSynthesis({ ...createVoiceScope(), format, voice: '' }, native.open, 512)
  await assert.rejects(synthesis.write('a'.repeat(513)), { code: 'resource_exhausted' })
  for (let index = 0; index < 8; index++) {
    await synthesis.write('a'.repeat(512))
    await synthesis.flush()
  }
  await assert.rejects(synthesis.write('a'), { code: 'resource_exhausted' })
  await synthesis.finish()
  assert.equal(native.segments.length, 8)
  const short = await openStreamingSynthesis({ ...createVoiceScope(), format, voice: '' }, native.open, 512)
  for (let index = 0; index < 64; index++) {
    await short.write('a')
    await short.flush()
  }
  await short.write('a')
  await assert.rejects(short.flush(), { code: 'resource_exhausted' })
  await short.close()
})

test('initial validation errors and abort during first open release ownership', async () => {
  let releases = 0
  const scope = createVoiceScope()
  await assert.rejects(
    openStreamingSynthesis(
      { ...scope, format, voice: '' },
      async () => {
        throw voiceError('unsupported_capability')
      },
      512,
      () => {
        releases++
      },
    ),
    { code: 'unsupported_capability' },
  )
  assert.equal(releases, 1)
  const native = renderer()
  const opened = deferred<void>()
  native.gateNext(opened.promise)
  const opening = openStreamingSynthesis({ ...scope, format, voice: '' }, native.open, 512)
  const rejected = assert.rejects(opening, { code: 'cancelled' })
  scope.abort()
  opened.resolve()
  await rejected
  assert.equal(native.segments[0].closed, 1)
})
