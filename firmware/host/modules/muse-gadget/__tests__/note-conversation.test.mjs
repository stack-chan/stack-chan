import assert from 'node:assert/strict'
import test from 'node:test'
import { createMuseNoteConversation } from '../note-conversation.js'

const deferred = () => {
  let resolve, reject
  const promise = new Promise((a, b) => {
    resolve = a
    reject = b
  })
  return { promise, resolve, reject }
}
const tick = () => new Promise((resolve) => setImmediate(resolve))

function fixture(options = {}) {
  const controller = new AbortController(),
    events = [],
    sent = [],
    closes = [],
    fences = []
  const response = deferred(),
    inputDone = deferred()
  let write
  const backend = {
    id: 'fixture',
    sendNote(pcm, scope) {
      sent.push({ pcm, signal: scope.signal })
      return response.promise
    },
    async close() {
      closes.push('backend')
    },
  }
  const link = {
    done: inputDone.promise,
    async close() {
      closes.push('link')
      inputDone.resolve()
    },
  }
  const media = {
    input: {},
    output: {
      async fence(epoch) {
        fences.push(epoch)
        return []
      },
    },
    media: {
      async connect() {
        return link
      },
    },
  }
  const conversation = createMuseNoteConversation({
    openBackend: async () => backend,
    createPcmSink(_format, callback) {
      write = callback
      return {}
    },
    maxRecordingBytes: 8,
    ...options,
  })
  return {
    controller,
    events,
    sent,
    closes,
    fences,
    response,
    inputDone,
    backend,
    link,
    media,
    write(bytes) {
      write(bytes)
    },
    open() {
      return conversation.open({
        media,
        signal: controller.signal,
        history: [],
        onEvent: (event) => events.push(event),
      })
    },
  }
}

test('press/release sends only retained PCM and wipes it after completion', async () => {
  const f = fixture(),
    s = await f.open()
  f.write(new Uint8Array([9, 9]))
  await s.setInputEnabled(true)
  f.write(new Uint8Array([1, 2, 3, 4]))
  await s.setInputEnabled(false)
  await tick()
  assert.deepEqual([...f.sent[0].pcm], [1, 2, 3, 4])
  await assert.rejects(s.setInputEnabled(true), { code: 'device_busy' })
  f.response.resolve({ status: 'completed', messages: [{ id: 'm', text: 'ok' }] })
  await tick()
  assert.deepEqual([...f.sent[0].pcm], [0, 0, 0, 0])
  assert.equal(f.events.at(-1).status, 'completed')
  await s.close({ mode: 'drain' })
})

test('overflow discards the entire recording without sending a truncated note', async () => {
  const f = fixture(),
    s = await f.open()
  await s.setInputEnabled(true)
  f.write(new Uint8Array(8))
  f.write(new Uint8Array(2))
  await s.setInputEnabled(false)
  await tick()
  assert.equal(f.sent.length, 0)
  assert.equal(f.events[0].code, 'resource_exhausted')
  await s.close()
})

test('abort before queued upload prevents transmission', async () => {
  const f = fixture(),
    s = await f.open()
  await s.setInputEnabled(true)
  f.write(new Uint8Array([1, 2]))
  const release = s.setInputEnabled(false)
  const closing = s.close()
  await release
  await closing
  await tick()
  assert.equal(f.sent.length, 0)
})

test('interrupt aborts upload, wipes retained PCM, fences playback and rejects reuse', async () => {
  const f = fixture(),
    s = await f.open()
  await s.setInputEnabled(true)
  f.write(new Uint8Array([1, 2]))
  await s.setInputEnabled(false)
  await tick()
  const count = f.events.length
  const result = await s.interrupt()
  assert.equal(result.remote, 'continued')
  assert.equal(result.history, 'restart-required')
  assert.equal(f.sent[0].signal.aborted, true)
  assert.deepEqual([...f.sent[0].pcm], [0, 0])
  await assert.rejects(s.setInputEnabled(true), { code: 'cancelled_unconfirmed' })
  f.response.resolve({ status: 'completed', messages: [{ id: 'late', text: 'suppressed' }] })
  await tick()
  assert.equal(f.events.length, count + 1)
  assert.equal(f.events.at(-1).status, 'interrupted')
  assert.equal((await s.close()).remoteFinalization, 'unknown')
})

test('close cleans backend even if input link cleanup fails', async () => {
  const f = fixture(),
    s = await f.open()
  f.link.close = async () => {
    f.closes.push('link')
    throw new Error('fixture')
  }
  const closing = s.close()
  assert.equal(s.close(), closing)
  await assert.rejects(closing)
  assert.deepEqual(f.closes.sort(), ['backend', 'link'])
  assert.equal(f.fences.length, 1)
})

test('abort while backend opens closes late acquired resource once', async () => {
  const opening = deferred()
  const f = fixture({ openBackend: () => opening.promise })
  const pending = f.open()
  f.controller.abort()
  await tick()
  opening.resolve(f.backend)
  await assert.rejects(pending, { code: 'cancelled' })
  assert.deepEqual(f.closes, ['backend'])
})

test('abort while media connects closes late acquired input link', async () => {
  const connecting = deferred(),
    f = fixture()
  f.media.media.connect = () => connecting.promise
  const pending = f.open()
  await tick()
  f.controller.abort()
  await tick()
  connecting.resolve(f.link)
  await assert.rejects(pending, { code: 'cancelled' })
  assert.deepEqual(f.closes.sort(), ['backend', 'link'])
})

test('close aborts and wipes a pending turn without claiming remote completion', async () => {
  const f = fixture(),
    s = await f.open()
  await s.setInputEnabled(true)
  f.write(new Uint8Array([1, 2]))
  await s.setInputEnabled(false)
  await tick()
  const result = await s.close({ mode: 'drain' })
  assert.equal(result.reason, 'aborted')
  assert.equal(result.remoteFinalization, 'unknown')
  assert.equal(f.sent[0].signal.aborted, true)
  assert.deepEqual([...f.sent[0].pcm], [0, 0])
  const count = f.events.length
  f.response.resolve({ status: 'completed', messages: [{ id: 'm', text: 'late' }] })
  await tick()
  assert.equal(f.events.length, count)
})

test('normal turns reuse the real PCM generation until output is fenced', async () => {
  let generation = 0
  const begun = []
  const f = fixture({ playReply: async (_message, { media, generation: epoch }) => {
    media.output.begin('reply', epoch)
    return []
  } })
  f.media.output.begin = (_id, epoch) => {
    assert.equal(epoch, generation, 'PCM begin rejects an unfenced epoch')
    begun.push(epoch)
    return {}
  }
  f.media.output.fence = async next => {
    assert(next > generation, 'PCM fence rejects a stale generation')
    generation = next
    return []
  }
  const s = await f.open()
  f.response.resolve({ status: 'completed', messages: [{ id: 'reply', text: 'ok' }] })
  for (let i = 0; i < 2; i++) {
    await s.setInputEnabled(true); f.write(new Uint8Array([1, 2])); await s.setInputEnabled(false); await tick()
  }
  assert.deepEqual(begun, [0, 0])
  assert.equal(f.events.filter(e => e.type === 'error').length, 0)
  await s.close()
  assert.equal(generation, 1)
})

test('B abort shares one fence between playback cleanup and Conversation close', async () => {
  let generation = 0, aborted
  const f = fixture({ playReply: (_message, { media, signal, generation: epoch, fencePlayback }) => new Promise(resolve => {
    signal.addEventListener('abort', () => {
      aborted = fencePlayback ? fencePlayback() : media.output.fence(epoch + 1)
      aborted.then(() => resolve([]), () => resolve([]))
    })
  }) })
  f.media.output.fence = async next => {
    assert(next > generation, 'PCM fence rejects a stale generation')
    generation = next
    return []
  }
  const s = await f.open()
  f.response.resolve({ status: 'completed', messages: [{ id: 'reply', text: 'ok' }] })
  await s.setInputEnabled(true); f.write(new Uint8Array([1, 2])); await s.setInputEnabled(false); await tick()
  await s.close()
  await aborted
  assert.equal(generation, 1)
})

test('a later turn gets a fresh fence after playback failure', async () => {
  let generation = 0, attempt = 0, aborted
  const fences = []
  const f = fixture({ playReply: async (_message, { signal, generation: epoch, fencePlayback }) => {
    assert.equal(epoch, generation)
    if (++attempt === 1) {
      await fencePlayback()
      throw Object.assign(new Error('decode'), { code: 'provider_failed' })
    }
    return new Promise(resolve => {
      signal.addEventListener('abort', () => {
        aborted = fencePlayback()
        aborted.then(() => resolve([]))
      })
    })
  } })
  f.media.output.fence = async next => {
    assert(next > generation)
    generation = next;fences.push(next)
    return []
  }
  const s = await f.open()
  f.response.resolve({ status: 'completed', messages: [{ id: 'reply', text: 'ok' }] })
  for (let i=0;i<2;i++) {
    await s.setInputEnabled(true);f.write(new Uint8Array([1,2]));await s.setInputEnabled(false);await tick()
  }
  await s.close();await aborted
  assert.deepEqual(fences,[1,2])
})
