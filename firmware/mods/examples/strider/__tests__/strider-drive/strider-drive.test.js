import { StriderDrive } from 'strider-drive'
import { assert, equal } from 'testing/assert'

function deferred() {
  let resolve
  const promise = new Promise((fulfill) => {
    resolve = fulfill
  })
  return { promise, resolve }
}

function setup(turnCenter, options = {}) {
  let now = 0
  let starts = 0
  let rawPosition = 650
  const powers = []
  const saved = []
  const errors = []
  const yaw = {
    async setPower(power, timeoutMs) {
      assert(timeoutMs > 0 && timeoutMs <= 400, 'Host power must have a bounded command lease')
      powers.push(power)
    },
    async readRawPosition() {
      return options.readRawPosition ? options.readRawPosition() : rawPosition
    },
    async close() {
      powers.push(0)
    },
  }
  const drive = new StriderDrive(
    {
      now: () => now,
      elapsed: (start) => now - start,
      startContinuousYaw: async () => {
        starts++
        await options.startGate
        return yaw
      },
      openGyro: () => ({ read: () => options.gyroAt?.(rawPosition), close: () => options.onGyroClose?.() }),
      saveTurnCenter: (value) => {
        equal(powers.at(-1), 0, 'calibration must stop before saving')
        saved.push(value)
      },
      notify() {},
      reportError: (error) => errors.push(String(error)),
    },
    turnCenter,
  )
  return {
    drive,
    powers,
    saved,
    errors,
    get starts() {
      return starts
    },
    advance: (ms) => {
      now += ms
    },
    set position(raw) {
      rawPosition = raw
    },
  }
}

function command(action, gesture = 1, power = 0.8) {
  return { action, gesture, power }
}

const walking = setup()
equal(walking.drive.receive(command('left')), false, 'uncalibrated turns must not start motion')
equal(walking.drive.receive(command('forward', 2, Infinity)), false, 'invalid power must not start motion')
await walking.drive.tick()
equal(walking.starts, 0, 'rejected commands must not acquire yaw')
assert(walking.drive.receive(command('forward', 2)), 'forward should be accepted')
await walking.drive.tick()
equal(walking.powers.at(-1), 0.8, 'forward should drive with positive power')
walking.advance(300)
walking.drive.receive(command('forward', 2))
await walking.drive.tick()
walking.advance(200)
await walking.drive.tick()
equal(walking.powers.at(-1), 0.8, 'heartbeat should renew the lease')
walking.advance(200)
await walking.drive.tick()
equal(walking.powers.at(-1), 0, 'expired heartbeat should stop motion')
equal(walking.drive.receive(command('forward', 2)), false, 'late heartbeat must not restart expired motion')
await walking.drive.tick()
equal(walking.starts, 1, 'late heartbeat must not acquire another yaw session')
walking.drive.receive(command('backward', 3))
await walking.drive.tick()
equal(walking.powers.at(-1), -0.8, 'fresh backward command should reverse power')
equal(walking.drive.receive(command('stop', 2)), false, 'older stop must not interrupt a newer gesture')
walking.drive.receive(command('stop', 3))
await walking.drive.tick()
equal(walking.powers.at(-1), 0, 'explicit stop should zero output')
equal(walking.drive.receive(command('backward', 3)), false, 'late heartbeat must not undo explicit stop')

walking.drive.receive(command('forward', 4))
await walking.drive.tick()
walking.drive.disconnect()
equal(walking.powers.at(-1), 0, 'BLE disconnect should stop before another tick')
await walking.drive.tick()
equal(walking.powers.at(-1), 0, 'no heartbeat should follow from reconnect by itself')
walking.drive.receive(command('forward'))
await walking.drive.tick()
equal(walking.powers.at(-1), 0.8, 'new link may start a fresh gesture')
await walking.drive.close()
equal(walking.powers.at(-1), 0, 'MOD close should zero output')
equal(walking.drive.receive(command('forward', 9)), false, 'closed MOD must reject commands')

const currentRead = deferred()
const readStarted = deferred()
const turning = setup(668, {
  readRawPosition() {
    readStarted.resolve()
    return currentRead.promise
  },
})
turning.drive.receive(command('right'))
const pendingTurn = turning.drive.tick()
await readStarted.promise
turning.drive.disconnect()
currentRead.resolve(668)
await pendingTurn
equal(turning.powers.length, 1, 'interrupted position read must not issue a turn command')
equal(turning.powers[0], 0, 'interrupted position read must stop')
await turning.drive.close()

const startGate = deferred()
const starting = setup(undefined, { startGate: startGate.promise })
starting.drive.receive(command('forward'))
const pendingStart = starting.drive.tick()
await Promise.resolve()
equal(starting.starts, 1, 'test must intercept an acquisition already in flight')
const modClosed = starting.drive.close()
startGate.resolve()
await pendingStart
await modClosed
equal(starting.powers.length, 1, 'late acquisition must only release the session')
equal(starting.powers[0], 0, 'late acquisition must be closed')

const failing = setup(668, {
  readRawPosition() {
    throw new Error('servo timeout')
  },
})
failing.drive.receive(command('left'))
await failing.drive.tick()
equal(failing.powers.at(-1), 0, 'servo read error should stop')
equal(failing.drive.state().status, 'error', 'servo read error should reach the UI')
equal(failing.drive.receive(command('left')), false, 'servo read error should consume the gesture')
await failing.drive.close()

const right = setup(668)
right.position = 668
right.drive.receive(command('right', 1, 0.2))
await right.drive.tick()
equal(right.powers.at(-1), 1, 'right turn should use the calibrated duty even at low walking power')
for (const raw of [633, 595, 552, 517]) {
  right.position = raw
  right.advance(25)
  await right.drive.tick()
}
equal(right.powers.at(-1), -1, 'right turn should reverse at the lower edge')
await right.drive.close()

const blind = setup(60)
blind.position = 60
blind.drive.receive(command('right', 1, 1))
await blind.drive.tick()
for (const raw of [29, 3, 3, 360]) {
  blind.position = raw
  blind.advance(25)
  await blind.drive.tick()
  equal(blind.powers.at(-1), 1, 'a false position in the blind zone must not reverse the turn early')
}
blind.advance(25)
await blind.drive.tick()
equal(blind.powers.at(-1), -1, 'turn should still reverse when its estimated position reaches the blind-zone edge')
await blind.drive.close()

const left = setup(668)
left.position = 668
left.drive.receive(command('left', 1, 1))
await left.drive.tick()
equal(left.powers.at(-1), -1, 'left and right turns should start in opposite directions at the same position')
await left.drive.close()

const shift = 650
const calibration = setup(undefined, {
  gyroAt: (position) => ({
    x: 20 * Math.cos(((position - 418 - shift) * 4 * Math.PI) / 1152),
    y: 12 * Math.cos(((position - 246 - shift) * 2 * Math.PI) / 1152),
  }),
})
for (let sample = 0; sample <= 640; sample++) {
  const position = (1000 - ((sample * 21) % 1152) + 1152) % 1152
  calibration.position = position > 1023 ? 3 : position
  if (sample % 4 === 0) calibration.drive.receive(command('calibrate'))
  await calibration.drive.tick()
  if (sample === 0) {
    equal(calibration.drive.state().status, 'calibrating', 'calibration should report a held run')
    equal(calibration.powers.at(-1), 0.6, 'calibration should first walk forward')
  }
  if (sample === 320) {
    equal(calibration.powers.at(-1), -0.6, 'calibration should return after collecting samples')
    equal(calibration.saved.length, 0, 'calibration must not save while still moving')
  }
  calibration.advance(25)
}
equal(calibration.powers.at(-1), 0, 'completed calibration should stop')
equal(calibration.saved[0], 166, 'calibration should recover the shifted center from the gyro phases')
equal(calibration.drive.state().status, 'calibrated', 'successful calibration should enable turns')
equal(calibration.drive.receive(command('calibrate')), false, 'late heartbeat must not restart completed calibration')
await calibration.drive.close()

let gyroClosed = false
const interrupted = setup(668, { onGyroClose: () => (gyroClosed = true) })
interrupted.drive.receive(command('calibrate'))
await interrupted.drive.tick()
interrupted.drive.receive(command('stop'))
await interrupted.drive.tick()
equal(interrupted.powers.at(-1), 0, 'stopping calibration should stop movement')
equal(gyroClosed, true, 'stopping calibration should release the gyro subscription')
equal(interrupted.saved.length, 0, 'stopping calibration should retain the previous setting')
equal(interrupted.drive.state().calibrated, true, 'interrupted recalibration should preserve existing turns')
await interrupted.drive.close()

trace('@@STACKCHAN_TEST:PASS@@\n')
