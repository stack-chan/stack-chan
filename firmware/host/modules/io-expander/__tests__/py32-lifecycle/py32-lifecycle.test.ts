import { openPorts, resetSerials } from 'embedded:io/serial'
import { M5StackChanServoDriver } from 'm5stackchan-servo-driver'
import { acquireSharedPY32IOExpander, tryAcquireSharedPY32IOExpander } from 'py32-io-expander'
import PY32Led from 'py32-led'
import { wait } from 'stackchan-util'
import { assert, equal } from 'testing/assert'

const io: FakeIO[] = []
let writes = 0
let failWriteAt = -1
let closeFails = false
let version = 0x41
let delays = 0
const initializationError = new Error('register setup failed')
class FakeIO {
  closes = 0
  registers = new Uint8Array(256)
  constructor(_options: Record<string, unknown>) {
    this.registers[2] = version
    io.push(this)
  }
  readUint8(register: number): number {
    return this.registers[register]
  }
  #write(): void {
    if (this.closes) throw new Error('write to closed I2C')
    if (++writes === failWriteAt) throw initializationError
  }
  writeUint8(register: number, value: number): void {
    this.#write()
    this.registers[register] = value
  }
  writeBuffer(register: number, buffer: Uint8Array): void {
    this.#write()
    this.registers.set(buffer, register)
  }
  close(): void {
    this.closes++
    if (closeFails) throw new Error('I2C close failed')
  }
}

const env = globalThis as unknown as { device?: unknown; Timer?: { delay: (ms: number) => void } }
const previousDevice = env.device
const previousTimer = env.Timer

async function sharedLifetimes(): Promise<void> {
  for (let cycle = 0; cycle < 100; cycle++) {
    const before = io.length
    const led = new PY32Led({ length: 2 })
    const driver = new M5StackChanServoDriver({ panId: 1, tiltId: 2 })
    equal(io.length, before + 1, 'LED and servo power acquire one I2C handle')
    const input = io[before]
    driver.onAttached()
    assert((input.registers[5] & 1) !== 0, 'servo power is enabled')
    led.on(255, 0, 0, 50)
    if (cycle % 2) {
      driver.close()
      equal(input.closes, 0, 'closing servo power preserves LED IO')
      equal(input.registers[5] & 1, 0, 'closing servo power disables its output')
      led.on(0, 255, 0, 50)
      led.close()
    } else {
      led.close()
      equal(input.closes, 0, 'closing LED preserves servo power IO')
      assert((input.registers[5] & 1) !== 0, 'closing LED does not turn off servo power')
      driver.onDetached()
      driver.onAttached()
      driver.close()
    }
    led.close()
    driver.close()
    driver.onDetached()
    equal(input.closes, 1)
    equal(openPorts.size, 0)
  }
  const settledWrites = writes
  await wait(80)
  equal(writes, settledWrites, 'closed LED timers never write later')
}

function constructionFailures(): void {
  for (const step of [1, 2, 3, 4, 5, 6, 8]) {
    const peer = acquireSharedPY32IOExpander()
    const input = io[io.length - 1]
    failWriteAt = writes + step
    let error: unknown
    try {
      new PY32Led({ length: 2 })
    } catch (caught) {
      error = caught
    }
    equal(error, initializationError, 'LED setup failure preserves the original error')
    equal(input.closes, 0, 'failed LED setup releases only its own lease')
    failWriteAt = -1
    peer.digitalWrite(0, true)
    assert(peer.getWriteValue(0), 'another user remains usable after LED rollback')
    peer.close()
    equal(input.closes, 1)
  }
  failWriteAt = writes + 1
  let error: unknown
  try {
    new M5StackChanServoDriver({ panId: 1, tiltId: 2 })
  } catch (caught) {
    error = caught
  }
  equal(error, initializationError, 'servo power setup failure preserves its error')
  equal(io[io.length - 1].closes, 1, 'failed servo power setup releases I2C')
  equal(openPorts.size, 0, 'failed power setup also releases both servo endpoints and UART')
  failWriteAt = -1
}

function unavailableHardware(): void {
  version = 0xff
  const before = io.length
  let errors = 0
  const missing = tryAcquireSharedPY32IOExpander(undefined, () => errors++)
  equal(missing, undefined)
  equal(errors, 1, 'optional acquisition reports one terminal failure')
  assert(io.length > before && delays > 0, 'startup probe retries are bounded')
  assert(
    io.slice(before).every((input) => input.closes === 1),
    'every failed probe releases its handle',
  )
  const led = new PY32Led({ length: 2 })
  led.close()
  const driver = new M5StackChanServoDriver({ panId: 1, tiltId: 2 })
  driver.close()
  equal(openPorts.size, 0, 'optional missing hardware does not leave servo UART ownership behind')
  version = 0x41
}

function closeFailures(): void {
  const led = new PY32Led({ length: 2 })
  const input = io[io.length - 1]
  failWriteAt = writes + 1
  closeFails = true
  let error: unknown
  try {
    led.close()
  } catch (caught) {
    error = caught
  }
  equal(error, initializationError, 'LED close preserves the first error when IO release also fails')
  equal(input.closes, 1, 'release is attempted even after an output error')
  led.close()
  let rejected = false
  try {
    acquireSharedPY32IOExpander()
  } catch {
    rejected = true
  }
  assert(rejected, 'uncertain I2C release prevents another acquisition')
  equal(io[io.length - 1], input)
}

async function run(): Promise<void> {
  resetSerials()
  env.device = { io: { SMBus: FakeIO }, I2C: { internal: { data: 12, clock: 13 } } }
  env.Timer = { delay: () => delays++ }
  try {
    await sharedLifetimes()
    constructionFailures()
    unavailableHardware()
    closeFailures()
    assert(
      io.every((input) => input.closes === 1),
      'every acquired I2C handle is released exactly once',
    )
    trace('ok\n')
  } finally {
    env.device = previousDevice
    env.Timer = previousTimer
  }
}

run().catch((error) => {
  trace(`PY32 lifecycle failed: ${String(error)}\n`)
  throw error
})
