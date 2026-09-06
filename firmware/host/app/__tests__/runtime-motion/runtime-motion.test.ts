import { channels, writes } from 'embedded:io/pwm'
import { AppSession } from 'app-session'
import clockTicks from 'clock-ticks'
import { StackchanRuntimeMotion } from 'runtime-motion'
import { PWMServoDriver } from 'sg90-driver'
import { defineApp } from 'stackchan'
import { wait } from 'stackchan-util'
import { assert, equal } from 'testing/assert'
import Time from 'time'
import Timer from 'timer'

async function run(): Promise<void> {
  let timers = 0
  const clock = {
    now: clockTicks,
    after(ms: number, callback: () => void) {
      let active = true
      timers += 1
      const timer = Timer.set(() => {
        if (!active) return
        active = false
        timers -= 1
        callback()
      }, ms)
      return () => {
        if (!active) return
        active = false
        timers -= 1
        Timer.clear(timer)
      }
    },
  }
  const driver = new PWMServoDriver({ pwmPan: 16, pwmTilt: 17 })
  for (let cycle = 0; cycle < 100; cycle += 1) {
    const errors: unknown[] = []
    const motion = new StackchanRuntimeMotion(driver, {
      clock,
      onPosition() {},
      onError: (error) => errors.push(error),
    })
    const session = new AppSession(
      {
        motion,
        face: { setEmotion() {}, setColor() {}, setMouthOpen() {} },
        audio: { async say() {}, async playClip() {}, async tone() {}, async close() {} },
        input: { subscribePress: () => () => {} },
        ui: { showBalloon() {}, hideBalloon() {}, showImage() {}, hideImage() {} },
        camera: {
          info: { availability: 'unavailable', formats: [], reason: 'Motion test has no camera' },
          async capture() {
            throw new Error('No camera')
          },
          async close() {},
        },
        capabilities: { get: () => motion.info },
      },
      clock,
      (error) => errors.push(error),
    )
    await session.start(defineApp({ setup() {} }))
    if (cycle === 0) trace('motion smoke: session started\n')
    const immediate = await session.context.motion.move({ yawDeg: 10, pitchDeg: 0 }, { durationMs: 0 })
    equal(immediate.completion, 'estimated', 'PWM never fabricates measured arrival')
    if (cycle === 0) trace('motion smoke: immediate move finished\n')
    if (cycle === 0) {
      const start = Time.ticks
      await session.context.motion.move({ yawDeg: -10, pitchDeg: 0 }, { durationMs: 55 })
      trace('motion smoke: timed move finished\n')
      assert((Time.ticks - start) >>> 0 >= 55, 'the API waits for the final trajectory sample')
      driver.getRotation((sample) => {
        assert(sample.success, 'the PWM driver retains its final command')
        if (sample.success) assert(Math.abs(sample.value.y + Math.PI / 18) < 0.000001)
      })
    }
    const moving = session.context.motion.move({ yawDeg: 20, pitchDeg: 0 }, { durationMs: 500 })
    let rejected = false
    const cancelled = moving.catch((error) => {
      equal(error.code, 'CLOSED')
      rejected = true
    })
    await wait(1)
    const closing = session.close()
    equal(closing, session.close())
    await closing
    if (cycle === 0) trace('motion smoke: app closed\n')
    await cancelled
    assert(rejected, 'app close cancels a pending motion')
    equal(timers, 0, 'frame, deadline, and app timers return to baseline')
    equal(errors.length, 0, 'normal app cancellation does not report a device failure')
    equal(session.taskCount, 0)
    equal(session.resourceCount, 0)
  }
  const before = writes.length
  await wait(30)
  equal(writes.length, before, 'closed sessions leave no interpolation callbacks')
  assert(
    channels.every((channel) => !channel.closed),
    'app close retains host-owned PWM outputs',
  )
  driver.close()
  assert(
    channels.every((channel) => channel.closed),
    'host close releases the PWM outputs',
  )
  trace('ok\n')
}

run().catch((error) => {
  trace(`runtime motion failed: ${error}\n`)
  throw error
})
