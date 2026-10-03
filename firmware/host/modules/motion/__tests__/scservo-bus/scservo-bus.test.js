import Serial, * as SerialNamespace from 'embedded:io/serial'
import * as ConfigNamespace from 'mc/config'
import { assert, equal } from 'testing/assert'
import Timer, * as TimerNamespace from 'testing/fakes/timer'
import NativeTimer from 'timer'

const modules = {
  timer: { namespace: TimerNamespace },
  'embedded:io/serial': { namespace: SerialNamespace },
  'mc/config': { namespace: ConfigNamespace },
}
for (const name of [
  'protocols/scservo',
  'single-wait-slot',
  'servo-command-error',
  'payload-buffer',
  'm5stackchan-servo',
  'm5stackchan-servo-driver',
  'scservo-driver',
  'motion-controller',
  'stackchan-util',
  'mac-address',
  'py32-io-expander',
])
  modules[name] = { source: name }
const compartment = new Compartment({ globals: { trace }, modules, resolveHook: (name) => name })
const SCServo = compartment.importNow('protocols/scservo').default
const { M5StackChanServoDriver } = compartment.importNow('m5stackchan-servo-driver')
const { SCServoDriver } = compartment.importNow('scservo-driver')

function response(id, payload = []) {
  const body = [id, payload.length + 2, 0, ...payload]
  return [255, 255, ...body, ~body.reduce((a, b) => a + b, 0) & 255]
}
function ack(id, payload) {
  Serial.instance.inject(response(id, payload))
  Timer.advance(0)
}
function last() {
  return Serial.instance.writes.at(-1)
}

function runTest() {
  const pan = new SCServo({ id: 1 })
  const tilt = new SCServo({ id: 2 })
  const serial = Serial.instance
  let completed = 0
  // Noise received while idle can leave a syntactically valid partial frame.
  // Neither it nor an unread old ACK may settle or corrupt the next command.
  serial.inject([255, 255, 1, 8, 0])
  serial.incoming.push(...response(1))
  pan.setTorque(true, () => tilt.setTorque(true, () => completed++))
  pan.readRawPosition(() => completed++)
  equal(serial.writes.length, 1, 'only the first command is on the bus')
  equal(completed, 0, 'buffered stale ACK cannot settle the new command')
  ack(1)
  equal(serial.writes.length, 2, 'one queued command starts after ACK')
  equal(last()[4], 2, 'FIFO keeps the already queued read before the chained tilt write')
  serial.inject(response(1))
  equal(serial.writes.length, 2, 'write ACK cannot settle a read')
  ack(1, [0, 10])
  equal(last()[2], 2, 'tilt starts after pan read response')
  equal(completed, 1, 'only pan read is complete')
  ack(2)
  equal(completed, 2, 'both operations completed')

  pan.setTorque(true, () => completed++)
  serial.inject([0, ...response(1).slice(0, 3)])
  serial.inject(response(1).slice(3))
  Timer.advance(0)
  equal(completed, 3, 'one noise byte followed by a split ACK is accepted')
  pan.setTorque(false, () => completed++)
  serial.inject([255, 255, 255, ...response(1).slice(2)])
  Timer.advance(0)
  equal(completed, 4, 'extra header byte does not lose synchronization')

  for (const length of [0, 1, 61, 255]) {
    pan.setTorque(false, () => completed++)
    serial.inject([255, 255, 1, length, ...response(1)])
    Timer.advance(0)
  }
  equal(completed, 8, 'invalid lengths cannot trap the parser')
  pan.setTorque(false, () => completed++)
  const broken = response(1)
  broken[broken.length - 1] ^= 1
  serial.inject([...broken, ...response(2), ...response(1)])
  Timer.advance(0)
  equal(completed, 9, 'checksum and wrong-ID responses are ignored')

  // A received ACK must win even if XS dispatches the timeout timer before
  // the queued Serial.onReadable callback.
  let bufferedCompleted = 0
  pan.setTorque(false, (error) => {
    assert(error == null, 'buffered ACK settles the write before timeout')
    bufferedCompleted++
  })
  serial.incoming.push(...response(1))
  Timer.advance(120)
  equal(bufferedCompleted, 1, 'already received ACK is accepted')
  serial.inject([])
  equal(bufferedCompleted, 1, 'delayed readable event cannot complete twice')
  Timer.advance(0)

  let timeouts = 0
  pan.setTorque(true, (error) => {
    assert(error != null, 'missing ACK reports an error')
    timeouts++
    tilt.setTorque(false, () => completed++)
  })
  const beforeTimeout = serial.writes.length
  Timer.advance(120)
  equal(timeouts, 1, 'timeout fires once')
  equal(serial.writes.length, beforeTimeout, 'callback cannot bypass recovery')
  serial.inject(response(1))
  Timer.advance(19)
  equal(serial.writes.length, beforeTimeout, 'recovery still owns the bus')
  Timer.advance(1)
  equal(serial.writes.length, beforeTimeout + 1, 'queued command starts after recovery')
  ack(2)
  equal(completed, 10, 'late ACK did not settle the next operation')

  // flashId changes the instance ID before a queued ID write is dispatched.
  // Its packet must still target the old ID, accepting ACKs at either ID.
  for (const ackAtNewId of [false, true]) {
    const oldId = pan.id
    const newId = oldId + 10
    let changed = false
    pan.flashId(newId, (error) => {
      assert(error == null, 'ID change succeeds')
      changed = true
    })
    ack(oldId)
    equal(last()[2], oldId, 'queued ID write targets old ID')
    equal(last()[5], 5, 'ID write register')
    ack(ackAtNewId ? newId : oldId)
    equal(last()[2], newId, 'lock targets new ID')
    ack(newId)
    assert(changed, 'flashId callback settles')
  }

  // Preserve the existing retry for Serial.write throwing (not ACK timeout).
  serial.failures = 1
  tilt.setTorque(true, () => completed++)
  Timer.advance(1)
  ack(2)
  equal(completed, 11, 'write exception retry remains supported')
  pan.teardown()
  tilt.teardown()

  for (const [Driver, panId] of [
    [M5StackChanServoDriver, 40],
    [SCServoDriver, 42],
  ]) {
    const driver = new Driver({
      panId,
      tiltId: panId + 1,
      servoPower: { type: 'none' },
      serial: { port: 2, receive: 16, transmit: 17 },
    })
    let result
    driver.setTorque(false, (error) => {
      result = error
    })
    equal(last()[2], panId, 'release begins with pan')
    Timer.advance(120)
    Timer.advance(20)
    equal(last()[2], panId + 1, 'tilt OFF is attempted despite pan timeout')
    ack(panId + 1)
    assert(result != null, 'original OFF failure is preserved')
  }
  trace('ok\n')
}
NativeTimer.set(runTest, 100)
