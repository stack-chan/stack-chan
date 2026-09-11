import { openPorts, resetSerials, serials } from 'embedded:io/serial'
import { DynamixelDriver } from 'dynamixel-driver'
import { M5StackChanServoDriver } from 'm5stackchan-servo-driver'
import Dynamixel from 'protocols/dynamixel'
import { dynamixelCrc16 } from 'protocols/dynamixel-codec'
import RS30X from 'protocols/rs30x'
import SCServo from 'protocols/scservo'
import { RS30XDriver } from 'rs30x-driver'
import { SCServoDriver } from 'scservo-driver'
import { wait, waitForCompletion } from 'stackchan-util'
import { assert, equal } from 'testing/assert'

function scResponse(id: number, data: number[] = []): Uint8Array {
  const packet = [0xff, 0xff, id, data.length + 2, 0, ...data]
  let sum = 0
  for (let i = 2; i < packet.length; i++) sum += packet[i]
  return new Uint8Array([...packet, ~sum & 0xff])
}

function dxResponse(id: number, data: number[] = [], status = 0): Uint8Array {
  const packet = [0xff, 0xff, 0xfd, 0, id, data.length + 4, 0, 0x55, status, ...data]
  const crc = dynamixelCrc16(packet)
  return new Uint8Array([...packet, crc & 0xff, crc >> 8])
}

function rsResponse(id: number, data: number[] = []): Uint8Array {
  const packet = [0xfd, 0xdf, id, 0, 0, data.length, 1, ...data]
  let checksum = 0
  for (let i = 2; i < packet.length; i++) checksum ^= packet[i]
  return new Uint8Array([...packet, checksum])
}

type Servo = {
  id: number
  close: () => void
  teardown: () => void
  setTorque: (value: boolean, callback?: (error?: unknown) => void) => void
  flashId: (id: number, callback?: (error?: unknown) => void) => void
}
const protocols: {
  create: (id: number) => Servo
  response: (id: number) => Uint8Array
  idOffset: number
  changeSteps: number
}[] = [
  { create: (id) => new SCServo({ id }), response: scResponse, idOffset: 2, changeSteps: 3 },
  { create: (id) => new Dynamixel({ id }), response: dxResponse, idOffset: 4, changeSteps: 2 },
  { create: (id) => new RS30X({ id }), response: rsResponse, idOffset: 2, changeSteps: 2 },
]

async function lifetimes(): Promise<void> {
  for (const protocol of protocols) {
    for (let cycle = 0; cycle < 100; cycle++) {
      const pan = protocol.create(1)
      const tilt = protocol.create(2)
      equal(openPorts.size, 1, 'two axes share one physical port')
      const serial = serials[serials.length - 1]
      serial.onWrite = (packet) => serial.emit(protocol.response(packet[protocol.idOffset]))
      await waitForCompletion((done) => {
        let completed = 0
        const callback = (error?: unknown) => {
          assert(error == null, 'torque acknowledgement succeeds')
          if (++completed === 2) done()
        }
        pan.setTorque(true, callback)
        tilt.setTorque(true, callback)
      })
      equal(serial.writes.length, 2)
      equal(serial.writes[0][protocol.idOffset], 1)
      equal(serial.writes[1][protocol.idOffset], 2)
      pan.close()
      pan.teardown()
      equal(serial.closes, 0)
      tilt.close()
      tilt.teardown()
      equal(serial.closes, 1)
      equal(openPorts.size, 0)
      const reads = serial.reads
      serial.emit(protocol.response(1))
      equal(serial.reads, reads, 'late onReadable does not read a closed transport')
    }
  }
}

async function arbitrationAndId(): Promise<void> {
  for (const protocol of protocols) {
    const pan = protocol.create(1)
    const tilt = protocol.create(2)
    const serial = serials[serials.length - 1]
    let results = 0
    pan.setTorque(true, () => results++)
    tilt.setTorque(true, () => results++)
    await wait(5)
    equal(serial.writes.length, 1, 'second axis waits for the active response')
    serial.emit(protocol.response(2))
    await wait(5)
    equal(results, 0, 'other ID cannot complete the active command')
    serial.emit(protocol.response(1))
    await wait(5)
    equal(serial.writes.length, 2)
    tilt.close()
    equal(results, 2, 'close completes the in-flight request once with an error')
    pan.close()

    const servo = protocol.create(1)
    const changingSerial = serials[serials.length - 1]
    let changingResult: unknown = 'pending'
    servo.flashId(5, (error) => {
      changingResult = error
    })
    let reserved = false
    try {
      protocol.create(5)
    } catch {
      reserved = true
    }
    assert(reserved, 'new ID is reserved before the first write')
    let externalError: unknown
    servo.setTorque(true, (error) => {
      externalError = error
    })
    assert(externalError instanceof Error, 'ordinary commands cannot interleave with ID changes')
    for (let step = 0; step < protocol.changeSteps; step++) {
      await wait(5)
      equal(changingSerial.writes.length, step + 1)
      changingSerial.emit(protocol.response(step === 0 ? 1 : 5))
    }
    await wait(5)
    equal(changingResult, undefined, 'ID change completes')
    equal(servo.id, 5)
    protocol.create(1).close()
    servo.flashId(6, () => {})
    servo.close()
    protocol.create(5).close()
    protocol.create(6).close()
    equal(openPorts.size, 0, 'closing during an ID change releases both aliases')
  }
}

async function packetParsing(): Promise<void> {
  const sc = new SCServo({ id: 1 })
  let serial = serials[serials.length - 1]
  let position: number | undefined
  sc.readRawPosition((result) => {
    if (result.success) position = result.value.position
  })
  await wait(5)
  serial.emit(serial.writes[0]) // Echo is not a status response.
  serial.emit(new Uint8Array([0xff, 0xff, 1, 255])) // Impossible frame length.
  const packet = scResponse(1, [1, 2])
  serial.emit(new Uint8Array([0x11]))
  serial.emit(packet.subarray(0, 3))
  serial.emit(packet.subarray(3))
  await wait(5)
  equal(position, 258, 'SCServo recovers after oversized input and accepts fragmented packets')
  sc.close()

  const dx = new Dynamixel({ id: 1 })
  serial = serials[serials.length - 1]
  dx.readPresentPosition((result) => {
    if (result.success) position = result.value
  })
  await wait(5)
  serial.emit(new Uint8Array([0xff, 0xff, 0xfd, 0, 1, 255, 255]))
  const corrupt = dxResponse(1, [166, 0, 0, 0])
  corrupt[corrupt.length - 1] ^= 1
  serial.emit(corrupt)
  await wait(5)
  equal(position, 258, 'bad CRC cannot complete the request')
  serial.emit(dxResponse(1, [166, 0, 0, 0]))
  await wait(5)
  equal(position, 166)
  let writeError: unknown
  dx.setTorque(true, (error) => {
    writeError = error
  })
  await wait(5)
  serial.emit(dxResponse(1, [], 4))
  await wait(5)
  assert(writeError instanceof Error, 'a device status error must not acknowledge a write successfully')
  await waitForCompletion((done) => {
    serial.onWrite = () => serial.emit(dxResponse(1))
    dx.setGoalPosition(0x00fdffff, done)
  })
  const stuffed = serial.writes[serial.writes.length - 1]
  equal(stuffed[13], 0xfd, 'header-like data is stuffed before the final parameter byte')
  equal(stuffed[14], 0, 'byte stuffing preserves the next parameter byte')
  serial.onWrite = () => serial.emit(dxResponse(1, [0xff, 0xff, 0xfd, 0xfd, 0]))
  await waitForCompletion((done) =>
    dx.readPresentPosition((result) => {
      assert(result.success && result.value === 0x00fdffff, 'stuffing is removed after CRC validation')
      done()
    }),
  )
  dx.setId(5)
  equal(dx.id, 5)
  const old = new Dynamixel({ id: 1 })
  old.close()
  let baudBusy = false
  try {
    Dynamixel.setBaud(115_200)
  } catch {
    baudBusy = true
  }
  assert(baudBusy, 'baud change cannot replace an owned UART')
  dx.close()

  const rs = new RS30X({ id: 1 })
  serial = serials[serials.length - 1]
  rs.readStatus((angle) => {
    position = angle
  })
  await wait(5)
  serial.emit(new Uint8Array([0xfd, 0xdf, 1, 0, 0, 255]))
  const data = new Array(18).fill(0)
  data[0] = 123
  serial.emit(rsResponse(1, data))
  await wait(5)
  equal(position, 12.3)
  rs.readStatus((angle) => {
    position = angle
  })
  await wait(5)
  data[0] = 0xf6
  data[1] = 0xff
  serial.emit(rsResponse(1, data))
  await wait(5)
  equal(position, -1, 'negative RS30X angles use signed 16-bit values')
  rs.close()
}

async function driverOwnership(): Promise<void> {
  const factories = [
    (tiltId: number) => new SCServoDriver({ panId: 1, tiltId }),
    (tiltId: number) => new RS30XDriver({ panId: 1, tiltId }),
    (tiltId: number) => new DynamixelDriver({ panId: 1, tiltId, baud: 1_000_000 }),
    (tiltId: number) => new M5StackChanServoDriver({ panId: 1, tiltId, servoPower: { type: 'none' } }),
  ]
  for (const create of factories) {
    let failed = false
    try {
      create(1)
    } catch {
      failed = true
    }
    assert(failed, 'duplicate tilt ID fails construction')
    equal(openPorts.size, 0, 'failed second axis releases the first axis and UART')
    const driver = create(2)
    driver.close()
    driver.close()
    let error: unknown
    driver.setTorque(true, (value) => {
      error = value
    })
    assert(error instanceof Error, 'closed driver rejects torque changes')
    equal(openPorts.size, 0)
  }
  const dx = new DynamixelDriver({ panId: 1, tiltId: 2, baud: 1_000_000, commandTimeoutMs: 10 })
  const serial = serials[serials.length - 1]
  let error: unknown
  dx.control((value) => {
    error = value
  })
  await wait(30)
  assert(error instanceof Error, 'a failed initialization cannot report success')
  dx.getRotation((result) => assert(!result.success, 'failed initialization cannot fabricate a position sample'))
  dx.close()
  const writes = serial.writes.length
  await wait(140)
  equal(serial.writes.length, writes, 'close prevents periodic control restarting')

  const detached = new DynamixelDriver({ panId: 1, tiltId: 2, baud: 1_000_000 })
  const positionSerial = serials[serials.length - 1]
  positionSerial.onWrite = (packet) => {
    const id = packet[4]
    const data = packet[7] === 2 ? [0, id === 1 ? 4 : 12, 0, 0] : []
    positionSerial.emit(dxResponse(id, data))
  }
  await waitForCompletion((done) => detached.setTorque(false, done))
  await waitForCompletion((done) => detached.control(done))
  detached.getRotation((result) => {
    assert(result.success, 'initialization retains measured positions even with torque off')
    if (result.success) {
      assert(Math.abs(result.value.y + Math.PI / 2) < 0.000001, 'pan reports its initial sample')
      assert(Math.abs(result.value.p - Math.PI / 2) < 0.000001, 'tilt reports its initial sample')
    }
  })
  detached.close()
}

async function changedDynamixelGoal(): Promise<void> {
  const driver = new DynamixelDriver({ panId: 1, tiltId: 2, baud: 1_000_000 })
  const serial = serials[serials.length - 1]
  const respond = (packet: Uint8Array) => {
    serial.emit(dxResponse(packet[4], packet[7] === 2 ? [0, 8, 0, 0] : []))
  }
  serial.onWrite = respond
  await waitForCompletion((done) => driver.control(done))
  const goals: number[] = []
  serial.onWrite = (packet) => {
    // Decode Goal Position writes on the actual protocol transport.
    if (packet[4] === 1 && packet[7] === 3 && packet[8] === 116 && packet[9] === 0) {
      goals.push(packet[10] | (packet[11] << 8) | (packet[12] << 16) | (packet[13] << 24))
      if (goals.length === 1) driver.applyRotation({ y: Math.PI / 2, p: 0, r: 0 })
    }
    respond(packet)
  }
  driver.applyRotation({ y: Math.PI / 4, p: 0, r: 0 })
  await waitForCompletion((done) => driver.control(done))
  await waitForCompletion((done) => driver.control(done))
  await waitForCompletion((done) => driver.control(done))
  equal(goals.length, 2, 'a target changed during ACK is sent on the following control cycle exactly once')
  equal(goals[0], 2560, 'the first transmitted goal represents the first requested yaw')
  equal(goals[1], 3072, 'the new yaw is not mistaken for an acknowledged goal')
  driver.close()
}

async function initialDynamixelGoal(): Promise<void> {
  const driver = new DynamixelDriver({ panId: 1, tiltId: 2, baud: 1_000_000 })
  const serial = serials[serials.length - 1]
  const goals: number[] = []
  let firstSample = true
  serial.onWrite = (packet) => {
    if (packet[4] === 1 && packet[7] === 2 && firstSample) {
      firstSample = false
      driver.applyRotation({ y: Math.PI / 2, p: 0, r: 0 })
    }
    if (packet[4] === 1 && packet[7] === 3 && packet[8] === 116 && packet[9] === 0) {
      goals.push(packet[10] | (packet[11] << 8) | (packet[12] << 16) | (packet[13] << 24))
    }
    serial.emit(dxResponse(packet[4], packet[7] === 2 ? [0, 8, 0, 0] : []))
  }
  driver.applyRotation({ y: Math.PI / 4, p: 0, r: 0 })
  await waitForCompletion((done) => driver.control(done))
  equal(goals.length, 1, 'initialization sends the pending target once')
  equal(goals[0], 3072, 'initial position sampling cannot overwrite a requested target')
  driver.close()
}

async function managedDynamixel(): Promise<void> {
  const driver = new DynamixelDriver({ panId: 1, tiltId: 2, baud: 1_000_000 })
  const serial = serials[serials.length - 1]
  const positions = [0, 2304, 2000]
  const goals: number[] = []
  const torque: boolean[] = []
  let pauseCurrent = false
  let heldId: number | undefined
  serial.onWrite = (packet) => {
    const id = packet[4]
    const address = packet[8] | (packet[9] << 8)
    if (packet[7] === 3 && address === 116) {
      positions[id] = packet[10] | (packet[11] << 8) | (packet[12] << 16) | (packet[13] << 24)
      if (id === 1) goals.push(positions[id])
    }
    if (packet[7] === 3 && address === 64) torque.push(packet[10] !== 0)
    if (pauseCurrent && packet[7] === 3 && address === 102) {
      pauseCurrent = false
      heldId = id
      return
    }
    const value = positions[id]
    serial.emit(dxResponse(id, packet[7] === 2 ? [value & 255, (value >> 8) & 255, 0, 0] : []))
  }
  driver.onAttached()
  await waitForCompletion((done) => driver.motion.prepare(done))
  equal(goals[0], 2304, 'managed initialization holds the sampled pose before enabling torque')
  const idleWrites = serial.writes.length
  await wait(150)
  equal(serial.writes.length, idleWrites, 'autonomous control cannot run while the motion service owns it')
  positions[1] = 2560
  await waitForCompletion((done) =>
    driver.motion.read((sample) => {
      assert(sample.success, 'managed read provides a fresh position')
      if (sample.success) assert(Math.abs(sample.value.y - Math.PI / 4) < 0.000001)
      done()
    }),
  )
  await waitForCompletion((done) => driver.motion.write({ y: 0.25, p: 0, r: 0 }, done))
  equal(
    goals[goals.length - 1],
    Math.floor((((0.25 * 180) / Math.PI + 180) * 4096) / 360),
    'managed write completes after sending its actual target',
  )
  driver.motion.release()
  const releasedWrites = serial.writes.length
  await wait(145)
  assert(serial.writes.length > releasedWrites, 'background holding resumes after release')

  const torqueStart = torque.length
  pauseCurrent = true
  let prepareError: unknown
  driver.motion.prepare((error) => {
    prepareError = error
  })
  for (let i = 0; i < 30 && heldId === undefined; i++) await wait(1)
  assert(heldId !== undefined, 'the test pauses an in-flight preparation command')
  driver.motion.release(new Error('stop deadline expired'))
  const relax = waitForCompletion((done) => driver.setTorque(false, done))
  serial.emit(dxResponse(heldId))
  await relax
  await wait(5)
  assert(prepareError instanceof Error, 'late preparation observes the revoked control generation')
  assert(
    torque.slice(torqueStart).every((enabled) => !enabled),
    'revoked preparation cannot re-enable torque after owner shutdown',
  )
  driver.close()
}

async function delayedDynamixelNotification(): Promise<void> {
  const driver = new DynamixelDriver({ panId: 1, tiltId: 2, baud: 1_000_000, commandTimeoutMs: 10 })
  const serial = serials[serials.length - 1]
  serial.onWrite = (packet) => {
    // Bytes arrive, but startup work delays delivery of onReadable past the timer.
    serial.emit(dxResponse(packet[4], packet[7] === 2 ? [0, 8, 0, 0] : []), false)
  }
  await waitForCompletion((done) => driver.control(done))
  assert(driver._initialized, 'buffered replies allow both axes to initialize without notifications')
  serial.options.onReadable.call(serial, 0)
  await waitForCompletion((done) => driver.control(done))
  driver.getRotation((sample) => {
    if (sample.success === false) throw new Error('control remains usable after delayed notifications')
    equal(sample.value.y, 0)
    equal(sample.value.p, 0)
  })
  driver.close()
}

async function dynamixelPositionGain(): Promise<void> {
  for (const [gain, tiltGain] of [
    [undefined, undefined],
    [0, undefined],
    [321, undefined],
    [123, 456],
    [321, 0],
    [undefined, 456],
  ]) {
    const driver = new DynamixelDriver({
      panId: 1,
      tiltId: 2,
      baud: 1_000_000,
      positionIGain: gain,
      tiltPositionIGain: tiltGain,
    })
    const serial = serials[serials.length - 1]
    const gains = new Map<number, number>()
    const enabled: number[] = []
    let gainWrites = 0
    serial.onWrite = (packet) => {
      const id = packet[4]
      if (packet[7] === 3) {
        const address = packet[8] | (packet[9] << 8)
        if (address === 11) gains.set(id, 0) // The servo resets PID on a mode change.
        if (address === 82) {
          gainWrites++
          gains.set(id, packet[10] | (packet[11] << 8))
        }
        if (address === 64 && packet[10] === 1) {
          equal(
            gains.get(id),
            (id === 2 ? (tiltGain ?? gain) : gain) ?? 0,
            'axis profile gain survives mode reset before torque is enabled',
          )
          enabled.push(id)
        }
      }
      serial.emit(dxResponse(id, packet[7] === 2 ? [0, 8, 0, 0] : []))
    }
    await waitForCompletion((done) => driver.control(done))
    equal(enabled.join(','), '1,2', 'both axes initialize')
    equal(
      gainWrites,
      Number(gain !== undefined) + Number((tiltGain ?? gain) !== undefined),
      'unconfigured axes keep the servo default',
    )
    driver.close()
  }
  const driver = new DynamixelDriver({ panId: 1, tiltId: 2, baud: 1_000_000, positionIGain: 100 })
  const serial = serials[serials.length - 1]
  let enabled = false
  serial.onWrite = (packet) => {
    const address = packet[8] | (packet[9] << 8)
    if (packet[7] === 3 && address === 64 && packet[10] === 1) enabled = true
    serial.emit(dxResponse(packet[4], packet[7] === 2 ? [0, 8, 0, 0] : [], address === 82 ? 4 : 0))
  }
  let failure: unknown
  await waitForCompletion((done) =>
    driver.control((error) => {
      failure = error
      done()
    }),
  )
  assert(failure instanceof Error, 'gain write failure rejects initialization')
  assert(!enabled, 'failed gain configuration cannot enable torque')
  driver.close()
  for (const gain of [-1, 0.5, 16384, Number.NaN]) {
    for (const key of ['positionIGain', 'tiltPositionIGain']) {
      let rejected = false
      try {
        new DynamixelDriver({ panId: 1, tiltId: 2, baud: 1_000_000, [key]: gain })
      } catch {
        rejected = true
      }
      assert(rejected, 'invalid gain is rejected')
      equal(openPorts.size, 0, 'invalid configuration does not acquire the UART')
    }
  }
}

async function dynamixelHoldingCurrent(): Promise<void> {
  const samples: number[][] = []
  for (const minimum of [undefined, 200]) {
    const driver = new DynamixelDriver({ panId: 1, tiltId: 2, baud: 1_000_000, tiltMinCurrent: minimum })
    const serial = serials[serials.length - 1]
    let position = 2048
    const currents: number[] = []
    serial.onWrite = (packet) => {
      if (packet[4] === 2 && packet[7] === 3 && packet[8] === 102) currents.push(packet[10] | (packet[11] << 8))
      serial.emit(dxResponse(packet[4], packet[7] === 2 ? [position & 255, position >> 8, 0, 0] : []))
    }
    for (position of [2048, 2047, 1024]) await waitForCompletion((done) => driver.control(done))
    equal(currents.length, 3)
    samples.push(currents)
    driver.close()
  }
  equal(samples[1][0], 200, 'the configured allowance remains available at the target')
  equal(samples[1][1], 200, 'small position errors cannot collapse the holding allowance')
  assert(samples[0][0] < samples[1][0], 'unconfigured drivers preserve the legacy near-target behavior')
  equal(samples[0][2], samples[1][2], 'a holding allowance does not increase the maximum current')
  for (const minimum of [-1, 0.5, Number.NaN, Number.MAX_SAFE_INTEGER]) {
    let rejected = false
    try {
      new DynamixelDriver({ panId: 1, tiltId: 2, baud: 1_000_000, tiltMinCurrent: minimum })
    } catch {
      rejected = true
    }
    assert(rejected, 'invalid current configuration is rejected')
    equal(openPorts.size, 0, 'validation precedes UART acquisition')
  }
}

async function dynamixelPitchClearance(): Promise<void> {
  for (const minimum of [-10, -8]) {
    const driver = new DynamixelDriver({ panId: 1, tiltId: 2, baud: 1_000_000, pitchMinDeg: minimum })
    const info = driver.motion.info
    if (info.availability === 'unavailable') throw new Error('motion should be available')
    equal(info.pitchDeg[0], minimum, 'SDK exposes the hardware profile limit')
    const serial = serials[serials.length - 1]
    const goals: number[] = []
    serial.onWrite = (packet) => {
      if (packet[4] === 2 && packet[7] === 3 && packet[8] === 116)
        goals.push(packet[10] | (packet[11] << 8) | (packet[12] << 16) | (packet[13] << 24))
      serial.emit(dxResponse(packet[4], packet[7] === 2 ? [0, 8, 0, 0] : []))
    }
    for (const pitch of [-45, 0, minimum, 25]) {
      driver.applyRotation({ y: 0, p: (pitch * Math.PI) / 180, r: 0 })
      await waitForCompletion((done) => driver.control(done))
      const degrees = (goals[goals.length - 1] * 360) / 4096 - 180
      assert(degrees >= info.pitchDeg[0] && degrees <= info.pitchDeg[1], 'encoded goals stay inside advertised limits')
      const expected = Math.max(info.pitchDeg[0], Math.min(info.pitchDeg[1], pitch))
      assert(Math.abs(degrees - expected) < 360 / 4096, 'clamping loses less than one encoder step')
    }
    driver.close()
  }
  for (const pitchMinDeg of [-31, 10, Number.NaN, Number.POSITIVE_INFINITY]) {
    let rejected = false
    try {
      new DynamixelDriver({ panId: 1, tiltId: 2, baud: 1_000_000, pitchMinDeg })
    } catch {
      rejected = true
    }
    assert(rejected, 'invalid clearance is rejected')
    equal(openPorts.size, 0, 'validation precedes UART acquisition')
  }
}

async function run(): Promise<void> {
  resetSerials()
  await lifetimes()
  await arbitrationAndId()
  await packetParsing()
  await driverOwnership()
  await changedDynamixelGoal()
  await initialDynamixelGoal()
  await managedDynamixel()
  await delayedDynamixelNotification()
  await dynamixelPositionGain()
  await dynamixelHoldingCurrent()
  await dynamixelPitchClearance()
  equal(openPorts.size, 0)
  assert(
    serials.every((serial) => serial.closes === 1),
    'all acquired transports close exactly once',
  )
  trace('ok\n')
}

run().catch((error) => {
  trace(`servo lifecycle failed: ${String(error)}\n`)
  throw error
})
