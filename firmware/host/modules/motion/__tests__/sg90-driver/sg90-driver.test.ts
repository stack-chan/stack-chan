import { channels, writes } from 'embedded:io/pwm'
import { PWMServoDriver } from 'sg90-driver'
import { wait, waitForCompletion } from 'stackchan-util'
import { assert, equal } from 'testing/assert'

const driver = new PWMServoDriver({
  pwmPan: 16,
  pwmTilt: 17,
})

async function run(): Promise<void> {
  await waitForCompletion((done) => driver.applyRotation({ y: 0.3, p: 0.1, r: 0 }, 0, done))
  equal(writes.length, 2, '0ms should write the final position immediately')
  assert(writes.every(Number.isFinite), 'PWM values must remain finite')
  driver.getRotation((result) => {
    assert(result.success, 'rotation should be available')
    if (result.success) assert(Math.abs(result.value.y - 0.3) < 0.000001, '0ms reaches the commanded yaw')
  })

  for (const duration of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
    let failure: unknown
    const before = writes.length
    driver.applyRotation({ y: 0, p: 0, r: 0 }, duration, (error) => {
      failure = error
    })
    assert(failure instanceof Error, 'invalid time should fail')
    equal(writes.length, before, 'invalid time must not write PWM')
  }
  driver.applyRotation({ y: 0, p: 0, r: 0 }, 0.02)
  await wait(80)
  driver.getRotation((result) => {
    assert(result.success && Math.abs(result.value.y) < 0.000001, 'trajectory writes its final sample')
  })
  driver.applyRotation({ y: 0.4, p: 0.1, r: 0 }, 0.5)
  driver.onDetached()
  const stoppedWrites = writes.length
  await wait(40)
  equal(writes.length, stoppedWrites, 'detach cancels the interpolation timer')
  driver.close()
  driver.close()
  assert(
    channels.every((channel) => channel.closed),
    'close releases both PWM outputs',
  )
  let closedError: unknown
  driver.applyRotation({ y: 0, p: 0, r: 0 }, 0, (error) => {
    closedError = error
  })
  assert(closedError instanceof Error, 'closed driver rejects new commands')
  trace('ok\n')
}

run().catch((error) => {
  trace(`PWM contract failed: ${error}\n`)
  throw error
})
