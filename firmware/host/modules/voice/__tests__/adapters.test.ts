import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { test } from 'node:test'
import { deferred } from '../scope.js'

const hooks = registerHooks({
  resolve(specifier, context, next) {
    const local = { 'stackchan/voice/media': '../media.js', 'stackchan/voice/scope': '../scope.js' }[specifier]
    return local ? { shortCircuit: true, url: new URL(local, import.meta.url).href } : next(specifier, context)
  },
})
const { createPcmSource, createPcmSink, mono, subscribePcmSource, writeSink } = await import('../adapters.js')
hooks.deregister()

test('PCM source keeps borrowed buffers until consumer release and ends after the final write', async () => {
  const source = createPcmSource(mono(16000))
  const pending = deferred<void>()
  const seen: string[] = []
  const samples = Uint8Array.of(1, 0)
  subscribePcmSource(source.output, {
    async write(bytes) {
      assert.equal(bytes, samples)
      await pending.promise
      seen.push(`sample:${bytes[0]}`)
    },
    end(error) {
      assert.equal(error, undefined)
      seen.push('end')
    },
  })
  const offered = source.push(samples)
  source.end()
  assert.deepEqual(seen, [])
  pending.resolve()
  await offered
  assert.deepEqual(seen, ['sample:1', 'end'])
  await assert.rejects(source.push(samples), { code: 'cancelled' })
})

test('PCM sink backpressure and source cancellation are explicit', async () => {
  const pending = deferred<void>()
  const sink = createPcmSink(mono(24000), () => pending.promise)
  let released = false
  const writing = writeSink(sink, Uint8Array.of(1, 0)).then(() => {
    released = true
  })
  await Promise.resolve()
  assert.equal(released, false)
  pending.resolve()
  await writing
  const source = createPcmSource(mono(24000))
  const failure = new Error('cancel')
  let ended: unknown
  const subscription = subscribePcmSource(source.output, {
    write() {},
    end(error) {
      ended = error
    },
  })
  source.end(failure)
  assert.equal(ended, failure)
  subscription.close()
  source.end()
  assert.throws(() => createPcmSource(mono(24000), 3), RangeError)
})

test('one failing end callback cannot strand another PCM subscriber', () => {
  const source = createPcmSource(mono(16000))
  let ended = 0
  subscribePcmSource(source.output, {
    write() {},
    end() {
      throw new Error('subscriber failure')
    },
  })
  subscribePcmSource(source.output, {
    write() {},
    end() {
      ended++
    },
  })
  source.end()
  source.end()
  assert.equal(ended, 1)
})

test('PCM subscriptions preserve the receiver of class consumer methods', async () => {
  class Consumer {
    samples: number[] = []
    ended = false
    write(bytes: Uint8Array) {
      this.samples.push(...bytes)
    }
    end() {
      this.ended = true
    }
  }
  const source = createPcmSource(mono(16000))
  const consumer = new Consumer()
  subscribePcmSource(source.output, consumer)
  await source.push(Uint8Array.of(1, 0))
  source.end()
  assert.deepEqual(consumer.samples, [1, 0])
  assert.equal(consumer.ended, true)
})

test('PCM end callbacks can close their producer without reentrant duplicate notifications', () => {
  const source = createPcmSource(mono(16000))
  let first = 0
  let second = 0
  subscribePcmSource(source.output, {
    write() {},
    end() {
      first++
      source.end(new Error('closed by consumer'))
    },
  })
  subscribePcmSource(source.output, {
    write() {},
    end() {
      second++
    },
  })
  source.end()
  assert.equal(first, 1)
  assert.equal(second, 1)
})

for (const failureKind of ['sync', 'async'] as const) {
  test(`PCM ${failureKind} failure waits for every remaining borrower before returning buffer ownership`, async () => {
    const source = createPcmSource(mono(16000))
    const release = deferred<void>()
    const failure = new Error('consumer failed')
    const samples = Uint8Array.of(1, 0)
    let observed = 0
    let returned = false
    subscribePcmSource(source.output, {
      write() {
        if (failureKind === 'sync') throw failure
        return Promise.reject(failure)
      },
      end() {},
    })
    subscribePcmSource(source.output, {
      async write(bytes) {
        await release.promise
        observed = bytes[0]
      },
      end() {},
    })
    const writing = source.push(samples).catch((error) => {
      returned = true
      assert.equal(error, failure)
      samples[0] = 9
    })
    await new Promise<void>((resolve) => setImmediate(resolve))
    assert.equal(returned, false)
    release.resolve()
    await writing
    assert.equal(returned, true)
    assert.equal(observed, 1)
    assert.equal(samples[0], 9)
    source.end()
  })
}
