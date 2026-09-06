import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import type { AppContext } from '../../sdk/app.js'
import { writeAliasPackage, writeAliasPackageSubpath } from '../modules/testing/node-alias-package.js'
import type { AppPorts } from './app-session.js'

async function setup() {
  const hostRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  writeAliasPackageSubpath(hostRoot, 'stackchan', 'errors', resolve(hostRoot, '../sdk/errors.js'))
  writeAliasPackageSubpath(resolve(hostRoot, '..'), 'stackchan', 'errors', resolve(hostRoot, '../sdk/errors.js'))
  for (const name of ['owned-resources', 'cancellation', 'task-scope']) {
    writeAliasPackage(hostRoot, name, resolve(hostRoot, `app/${name}.js`))
  }
  const { AppSession } = await import('./app-session.js')
  const { OperationQueue } = await import('./operation-queue.js')
  const { defineApp } = await import('../../sdk/app.js')
  return { AppSession, OperationQueue, defineApp }
}

class Clock {
  jobs = new Set<() => void>()
  after(_ms: number, callback: () => void): () => void {
    this.jobs.add(callback)
    return () => {
      this.jobs.delete(callback)
    }
  }
  tick(): void {
    for (const job of [...this.jobs]) if (this.jobs.delete(job)) job()
  }
}

const flush = async () => {
  for (let i = 0; i < 16; i += 1) await Promise.resolve()
}

function fixture() {
  const clock = new Clock()
  const presses = new Set<() => void>()
  const errors: unknown[] = []
  const ports: AppPorts = {
    motion: {
      info: { availability: 'unavailable', reason: 'No test motion device' },
      async move() {
        throw new Error('No test motion device')
      },
      lookAt() {},
      lookAway() {},
      async stop() {},
      async close() {},
    },
    face: { setEmotion() {}, setMouthOpen() {}, setColor() {} },
    audio: { async say() {}, async tone() {}, async playClip() {} },
    input: {
      subscribePress: (handler) => {
        presses.add(handler)
        return () => {
          presses.delete(handler)
        }
      },
    },
    ui: { showBalloon() {}, hideBalloon() {}, showImage() {}, hideImage() {} },
    camera: {
      info: { availability: 'unavailable', reason: 'test', formats: [] },
      async capture() {
        throw new Error('unavailable')
      },
      async close() {},
    },
    capabilities: { get: () => ({ availability: 'simulated' }) },
  }
  return { clock, presses, errors, ports }
}

test('setup completes while registrations stay alive; presses do not overlap', async () => {
  const { AppSession, defineApp } = await setup()
  const f = fixture()
  const session = new AppSession(f.ports, f.clock, (error) => f.errors.push(error))
  let calls = 0
  const started = session.start(
    defineApp({
      setup(app) {
        app.input.onPress('primary', async (task) => {
          calls += 1
          await task.sleep(1)
        })
      },
    }),
  )
  assert.equal(started, session.start(defineApp({ setup() {} })))
  await started
  assert.equal(session.state, 'running')
  const press = [...f.presses][0]
  press()
  press()
  press()
  await flush()
  assert.equal(calls, 1)
  f.clock.tick()
  await flush()
  press()
  await flush()
  assert.equal(calls, 2)
  const closed = session.close()
  assert.equal(closed, session.close())
  await closed
  press()
  assert.equal(calls, 2)
  assert.equal(f.presses.size, 0)
  assert.equal(f.clock.jobs.size, 0)
  assert.equal(session.taskCount, 0)
  assert.deepEqual(f.errors, [])
})

test('setup failure rolls back timers and inputs; errors reach the caller', async () => {
  const { AppSession, defineApp } = await setup()
  const f = fixture()
  const session = new AppSession(f.ports, f.clock, (error) => f.errors.push(error))
  await assert.rejects(
    session.start(
      defineApp({
        setup(app) {
          app.time.every(10, () => {})
          app.input.onPress('primary', () => {})
          throw new Error('setup failed')
        },
      }),
    ),
    /setup failed/,
  )
  assert.equal(session.state, 'closed')
  assert.equal(session.resourceCount, 0)
  assert.equal(f.clock.jobs.size, 0)
  assert.equal(f.presses.size, 0)
})

test('app close cancels only its own queued and active device operations', async () => {
  const { AppSession, OperationQueue, defineApp } = await setup()
  const f = fixture()
  const queue = new OperationQueue({ clock: f.clock })
  const starts: string[] = []
  let cancelled = 0
  let finish: () => void
  f.ports.audio.say = (text, options) =>
    queue.run(
      () => {
        starts.push(text)
        return new Promise<void>((resolve) => {
          finish = resolve
        })
      },
      () => {
        cancelled += 1
      },
      options?.signal,
    )
  const session = new AppSession(f.ports, f.clock, (error) => f.errors.push(error))
  await session.start(defineApp({ setup() {} }))
  const active = session.context.audio.say('first')
  const pending = session.context.audio.say('second')
  await flush()
  const failures = Promise.all([
    assert.rejects(active, { code: 'CLOSED' }),
    assert.rejects(pending, { code: 'CLOSED' }),
  ])
  const closed = session.close()
  await assert.rejects(session.context.audio.say('after close'), { code: 'CLOSED' })
  await closed
  await failures
  finish()
  await flush()
  assert.equal(cancelled, 1)
  assert.deepEqual(starts, ['first'])
  assert.equal(queue.size, 0)
  assert.equal(queue.closed, false)
  assert.equal(await queue.run(() => 'another app'), 'another app')
  assert.equal(f.clock.jobs.size, 0)
})

test('late setup completion disposes resources without reopening a closed app', async () => {
  const { AppSession, defineApp } = await setup()
  const f = fixture()
  const session = new AppSession(f.ports, f.clock, (error) => f.errors.push(error))
  let finish: (dispose: () => void) => void
  let disposed = 0
  const started = session.start(
    defineApp({
      setup: () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    }),
  )
  const failed = assert.rejects(started, { code: 'CLOSED' })
  await flush()
  await session.close()
  await failed
  finish(() => {
    disposed += 1
  })
  await flush()
  assert.equal(disposed, 1)
  assert.equal(session.state, 'closed')
})

test('100 app replacements return tasks, subscriptions and timers to baseline', async () => {
  const { AppSession, defineApp } = await setup()
  const f = fixture()
  for (let cycle = 0; cycle < 100; cycle += 1) {
    const session = new AppSession(f.ports, f.clock, (error) => f.errors.push(error))
    let app: AppContext
    await session.start(
      defineApp({
        setup(context) {
          app = context
          context.time.every(1, async (task) => {
            await task.sleep(1)
          })
          context.input.onPress('primary', () => {})
        },
      }),
    )
    f.clock.tick()
    await flush()
    await session.close()
    await assert.rejects(session.start(defineApp({ setup() {} })), { code: 'CLOSED' })
    await assert.rejects(app.time.sleep(1), { code: 'CLOSED' })
    assert.throws(() => app.face.setEmotion('happy'), { code: 'CLOSED' })
    assert.equal(f.clock.jobs.size, 0)
    assert.equal(f.presses.size, 0)
    assert.equal(session.taskCount, 0)
    assert.equal(session.resourceCount, 0)
  }
  assert.deepEqual(f.errors, [])
})

test('handler failure is reported once and does not leave a recurring timer alive', async () => {
  const { AppSession, defineApp } = await setup()
  const f = fixture()
  const session = new AppSession(f.ports, f.clock, (error) => f.errors.push(error))
  await session.start(
    defineApp({
      setup(app) {
        app.time.every(1, () => {
          throw new Error('handler failed')
        })
      },
    }),
  )
  f.clock.tick()
  await flush()
  assert.equal(f.errors.length, 1)
  assert.match(String(f.errors[0]), /handler failed/)
  assert.equal(f.clock.jobs.size, 0)
  assert.equal(session.resourceCount, 0)
  await session.close()
})

test('app registration limits fail before acquiring another input subscription', async () => {
  const { AppSession, defineApp } = await setup()
  const f = fixture()
  const session = new AppSession(f.ports, f.clock, (error) => f.errors.push(error))
  await session.start(defineApp({ setup() {} }))
  for (let i = 0; i < 64; i += 1) session.context.input.onPress('primary', () => {})
  assert.throws(() => session.context.input.onPress('primary', () => {}), { code: 'BUSY' })
  assert.equal(f.presses.size, 64)
  await session.close()
  assert.equal(f.presses.size, 0)
})

test('closing before task dispatch prevents handlers and devices from starting', async () => {
  const { AppSession, defineApp } = await setup()
  const f = fixture()
  let starts = 0
  f.ports.audio.say = async () => {
    starts += 1
  }
  const session = new AppSession(f.ports, f.clock, (error) => f.errors.push(error))
  await session.start(
    defineApp({
      setup(app) {
        app.input.onPress('primary', () => {
          starts += 1
        })
      },
    }),
  )
  const pending = session.context.audio.say('queued')
  for (const press of f.presses) press()
  const failed = assert.rejects(pending, { code: 'CLOSED' })
  await session.close()
  await failed
  assert.equal(starts, 0)
  assert.deepEqual(f.errors, [])
})

test('app camera combines cancellation and owns image UI and capture service on close', async () => {
  const { AppSession, defineApp } = await setup()
  const f = fixture()
  const events: string[] = []
  let context: AppContext
  f.ports.camera = {
    info: { availability: 'native', formats: ['rgb565le'] },
    capture(options) {
      return new Promise((_resolve, reject) => {
        options.signal.subscribe((reason) => {
          events.push('cancel')
          reject(reason)
        })
      })
    },
    async close() {
      events.push('camera close')
    },
  }
  f.ports.ui.showImage = () => {
    events.push('image')
  }
  f.ports.ui.hideImage = () => {
    events.push('hide image')
  }
  const session = new AppSession(f.ports, f.clock, (error) => f.errors.push(error))
  await session.start(
    defineApp({
      setup(app) {
        context = app
      },
    }),
  )
  context.ui.showImage({ width: 1, height: 1, format: 'rgb565le', source: 'native', data: new ArrayBuffer(2) })
  const pending = context.camera.capture()
  const failed = assert.rejects(pending, { code: 'CLOSED' })
  await flush()
  await session.close()
  await failed
  assert.deepEqual(events, ['image', 'cancel', 'camera close', 'hide image'])
  assert.throws(
    () => context.ui.showImage({ width: 1, height: 1, format: 'rgb565le', source: 'native', data: new ArrayBuffer(2) }),
    { code: 'CLOSED' },
  )
  assert.equal(f.clock.jobs.size, 0)
})
