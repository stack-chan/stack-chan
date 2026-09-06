import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import type { MotionPort } from '../modules/motion/motion-port.js'
import { writeAliasPackage, writeAliasPackageSubpath } from '../modules/testing/node-alias-package.js'
import type { Rotation } from '../modules/util/stackchan-util.js'

async function setup() {
  const hostRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  writeAliasPackageSubpath(hostRoot, 'stackchan', 'errors', resolve(hostRoot, '../sdk/errors.js'))
  for (const name of ['owned-resources', 'operation-queue', 'cancellation', 'motion-execution'])
    writeAliasPackage(hostRoot, name, resolve(hostRoot, `app/${name}.js`))
  const { StackchanRuntimeMotion } = await import('./runtime-motion.js')
  const { CancellationSource } = await import('./cancellation.js')
  return { StackchanRuntimeMotion, CancellationSource }
}

async function flush(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await Promise.resolve()
}

class Clock {
  tick = 0
  jobs = new Set<{ due: number; callback: () => void }>()
  now = () => this.tick >>> 0
  after(ms: number, callback: () => void): () => void {
    const job = { due: this.tick + ms, callback }
    this.jobs.add(job)
    if (ms === 0)
      void Promise.resolve().then(() => {
        if (this.jobs.delete(job)) job.callback()
      })
    return () => {
      this.jobs.delete(job)
    }
  }
  async advance(ms: number): Promise<void> {
    await flush()
    const end = this.tick + ms
    for (;;) {
      const next = [...this.jobs].sort((a, b) => a.due - b.due)[0]
      if (!next || next.due > end) break
      this.tick = next.due
      this.jobs.delete(next)
      next.callback()
      await flush()
    }
    this.tick = end
    await flush()
  }
}

function fixture(feedback: 'measured' | 'estimated' = 'estimated') {
  const clock = new Clock()
  const events: string[] = []
  const commands: { yaw: number; at: number }[] = []
  const position: Rotation = { y: 0, p: 0, r: 0 }
  const config = { ackMs: 0, followWrites: true, failHold: false }
  let active = false
  const motion: MotionPort = {
    info: { availability: 'simulated', feedback, canRelax: true, yawDeg: [-80, 80], pitchDeg: [-25, 10] },
    intervalMs: 20,
    prepare(done) {
      assert.equal(active, false)
      active = true
      events.push('prepare')
      done()
    },
    read(done) {
      assert.ok(active)
      done({ success: true, value: position })
    },
    write(rotation, done) {
      assert.ok(active)
      const value = { ...rotation }
      commands.push({ yaw: (value.y * 180) / Math.PI, at: clock.tick })
      const complete = () => {
        if (config.followWrites) Object.assign(position, value)
        done(config.failHold ? new Error('hold failed') : undefined)
      }
      if (config.ackMs) clock.after(config.ackMs, complete)
      else complete()
    },
    release(error) {
      active = false
      events.push(error ? 'fault' : 'release')
    },
  }
  const driver = {
    motion,
    applyRotation(_rotation: Rotation) {
      throw new Error('Legacy motion must not run')
    },
    getRotation() {
      throw new Error('Legacy sample must not run')
    },
    setTorque(enabled: boolean, done?: (error?: unknown) => void) {
      events.push(`torque:${enabled}`)
      done?.()
    },
    onAttached() {
      events.push('attach')
    },
    onDetached() {
      events.push('detach')
    },
  }
  const errors: Error[] = []
  const options = { clock, onPosition() {}, onError: (error: Error) => errors.push(error) }
  return { clock, driver, options, events, commands, position, config, errors }
}

test('relax retains ownership until torque release acknowledges, then permits another move', async () => {
  const { StackchanRuntimeMotion } = await setup()
  const f = fixture()
  let release: ((error?: unknown) => void) | undefined
  f.driver.setTorque = (enabled, done) => {
    assert.equal(enabled, false)
    release = done
  }
  const motion = new StackchanRuntimeMotion(f.driver, f.options)
  const moving = motion.move({ yawDeg: 20, pitchDeg: 0 }, { durationMs: 500 })
  const cancelled = assert.rejects(moving, { code: 'CANCELLED' })
  await f.clock.advance(20)
  let complete = false
  const relaxing = motion.relax().then(() => {
    complete = true
  })
  await f.clock.advance(0)
  assert.ok(release)
  assert.equal(complete, false)
  await assert.rejects(motion.move({ yawDeg: 0, pitchDeg: 0 }, { durationMs: 0 }), { code: 'BUSY' })
  release()
  await relaxing
  await cancelled
  const next = motion.move({ yawDeg: 0, pitchDeg: 0 }, { durationMs: 0 })
  await f.clock.advance(0)
  await next
  const closing = motion.close()
  await f.clock.advance(0)
  release()
  await closing
  assert.equal(f.clock.jobs.size, 0)
})

test('motion waits for the actual final trajectory write and reports estimated completion', async () => {
  const { StackchanRuntimeMotion } = await setup()
  const f = fixture()
  const motion = new StackchanRuntimeMotion(f.driver, f.options)
  let complete = false
  const move = motion.move({ yawDeg: 20, pitchDeg: 0 }, { durationMs: 55 }).then((result) => {
    complete = true
    return result
  })
  await f.clock.advance(54)
  assert.equal(complete, false)
  assert.ok(f.commands.at(-1).yaw < 20)
  await f.clock.advance(1)
  assert.deepEqual(await move, { completion: 'estimated' })
  assert.equal(f.commands.at(-1).at, 55)
  assert.equal(f.commands.at(-1).yaw, 20)
  await motion.close()
  assert.equal(f.clock.jobs.size, 0)
})

test('measured arrival waits for fresh position confirmations after the trajectory', async () => {
  const { StackchanRuntimeMotion } = await setup()
  const f = fixture('measured')
  f.config.followWrites = false
  const motion = new StackchanRuntimeMotion(f.driver, f.options)
  let complete = false
  const move = motion.move({ yawDeg: 20, pitchDeg: 0 }, { durationMs: 100, completion: 'measured' }).then((result) => {
    complete = true
    return result
  })
  await f.clock.advance(150)
  assert.equal(complete, false)
  f.position.y = (20 * Math.PI) / 180
  await f.clock.advance(50)
  assert.equal(complete, false, 'one sample does not confirm a settled arrival')
  await f.clock.advance(50)
  assert.deepEqual(await move, { completion: 'measured' })
  await motion.close()
  assert.equal(f.clock.jobs.size, 0)
})

test('0ms, finite limits, unsupported measurement, and wrapped monotonic time have explicit behavior', async () => {
  const { StackchanRuntimeMotion } = await setup()
  const f = fixture()
  const motion = new StackchanRuntimeMotion(f.driver, f.options)
  for (const durationMs of [Number.NaN, Number.POSITIVE_INFINITY, -1])
    await assert.rejects(motion.move({ yawDeg: 10, pitchDeg: 0 }, { durationMs }), { code: 'INVALID_ARGUMENT' })
  await assert.rejects(motion.move({ yawDeg: 81, pitchDeg: 0 }, { durationMs: 10 }), { code: 'INVALID_ARGUMENT' })
  await assert.rejects(motion.move({ yawDeg: 10, pitchDeg: 0 }, { durationMs: 10, completion: 'measured' }), {
    code: 'UNSUPPORTED',
  })
  assert.equal(f.commands.length, 0)
  const immediate = motion.move({ yawDeg: 10, pitchDeg: 0 }, { durationMs: 0 })
  await f.clock.advance(0)
  assert.deepEqual(await immediate, { completion: 'estimated' })
  f.clock.tick = 0xfffffff0
  const wrapped = motion.move({ yawDeg: 20, pitchDeg: 0 }, { durationMs: 40 })
  await f.clock.advance(40)
  await wrapped
  assert.equal(f.commands.at(-1).yaw, 20)
  await motion.close()
})

test('cancellation drains a pending driver write and holds before the following move', async () => {
  const { StackchanRuntimeMotion, CancellationSource } = await setup()
  const f = fixture()
  f.config.ackMs = 20
  const source = new CancellationSource()
  const motion = new StackchanRuntimeMotion(f.driver, f.options)
  const first = motion.move({ yawDeg: 30, pitchDeg: 0 }, { durationMs: 100, signal: source.signal })
  const cancelled = assert.rejects(first, { code: 'CANCELLED' })
  await f.clock.advance(30)
  source.cancel()
  const second = motion.move({ yawDeg: -10, pitchDeg: 0 }, { durationMs: 0 })
  await f.clock.advance(29)
  assert.equal(f.events.filter((event) => event === 'prepare').length, 1)
  await f.clock.advance(21)
  await cancelled
  await second
  assert.deepEqual(f.events.slice(0, 5), ['attach', 'prepare', 'release', 'prepare', 'release'])
  assert.equal(source.size, 0)
  await motion.close()
  assert.equal(f.clock.jobs.size, 0)
})

test('foreground moves preempt gaze and restore its latest target without an unbounded queue', async () => {
  const { StackchanRuntimeMotion } = await setup()
  const f = fixture()
  const motion = new StackchanRuntimeMotion(f.driver, f.options)
  motion.lookAt({ yawDeg: 30, pitchDeg: 0 })
  await f.clock.advance(100)
  const move = motion.move({ yawDeg: -20, pitchDeg: 0 }, { durationMs: 100 })
  for (let yawDeg = 1; yawDeg <= 10; yawDeg += 1) motion.lookAt({ yawDeg, pitchDeg: 0 })
  await f.clock.advance(100)
  await move
  assert.ok(f.commands.some((command) => Math.abs(command.yaw + 20) < 0.000001))
  await f.clock.advance(500)
  assert.ok(Math.abs(f.commands.at(-1).yaw - 10) < 0.000001)
  const writes = f.commands.length
  await f.clock.advance(1000)
  assert.equal(f.commands.length, writes, 'an unchanged, achieved gaze does not enqueue more work')
  await motion.stop()
  assert.equal(motion.gazePoint, null)
  const afterStop = motion.move({ yawDeg: 0, pitchDeg: 0 }, { durationMs: 0 })
  await f.clock.advance(0)
  await afterStop
  await motion.close()
  assert.equal(f.clock.jobs.size, 0)
  assert.equal(f.errors.length, 0)
})

test('timeout stops the trajectory; failed hold faults the resource and rejects its queue', async () => {
  const { StackchanRuntimeMotion } = await setup()
  const f = fixture()
  const motion = new StackchanRuntimeMotion(f.driver, f.options)
  const first = motion.move({ yawDeg: 30, pitchDeg: 0 }, { durationMs: 100, timeoutMs: 30 })
  const failed = assert.rejects(first, { code: 'TIMEOUT' })
  const second = motion.move({ yawDeg: -10, pitchDeg: 0 }, { durationMs: 0 })
  const rejected = assert.rejects(second, { code: 'IO' })
  await f.clock.advance(20)
  f.config.failHold = true
  await f.clock.advance(10)
  await Promise.all([failed, rejected])
  assert.equal(motion.info.availability, 'unavailable')
  await assert.rejects(motion.close(), { code: 'IO' })
  assert.equal(f.clock.jobs.size, 0)
  assert.equal(f.events.at(-1), 'detach')
})

test('stop cancels moves, reports BUSY until the hold completes, then allows a new move', async () => {
  const { StackchanRuntimeMotion } = await setup()
  const f = fixture()
  f.config.ackMs = 20
  const motion = new StackchanRuntimeMotion(f.driver, f.options)
  const active = assert.rejects(motion.move({ yawDeg: 30, pitchDeg: 0 }, { durationMs: 100 }), { code: 'CANCELLED' })
  await f.clock.advance(30)
  const queued = assert.rejects(motion.move({ yawDeg: -10, pitchDeg: 0 }, { durationMs: 0 }), { code: 'CANCELLED' })
  const stopped = motion.stop()
  assert.equal(stopped, motion.stop())
  await flush()
  await assert.rejects(motion.move({ yawDeg: 0, pitchDeg: 0 }, { durationMs: 0 }), { code: 'BUSY' })
  await f.clock.advance(30)
  await Promise.all([active, queued, stopped])
  assert.equal(f.events.filter((event) => event === 'prepare').length, 1)
  const next = motion.move({ yawDeg: 0, pitchDeg: 0 }, { durationMs: 0 })
  await f.clock.advance(20)
  await next
  await motion.close()
  assert.equal(motion.info.availability, 'unavailable')
  assert.equal(f.clock.jobs.size, 0)
})

test('100 app motion lifetimes cancel active gaze and leave no timers or commands after close', async () => {
  const { StackchanRuntimeMotion } = await setup()
  const f = fixture()
  for (let cycle = 0; cycle < 100; cycle += 1) {
    const motion = new StackchanRuntimeMotion(f.driver, f.options)
    motion.lookAt({ yawDeg: 20, pitchDeg: 0 })
    await f.clock.advance(100)
    const close = motion.close()
    assert.equal(close, motion.close())
    await close
    assert.equal(f.clock.jobs.size, 0)
    const writes = f.commands.length
    await f.clock.advance(100)
    assert.equal(f.commands.length, writes)
    await assert.rejects(motion.move({ yawDeg: 0, pitchDeg: 0 }, { durationMs: 0 }), { code: 'CLOSED' })
  }
  assert.equal(f.events.filter((event) => event === 'attach').length, 100)
  assert.equal(f.events.filter((event) => event === 'detach').length, 100)
})
