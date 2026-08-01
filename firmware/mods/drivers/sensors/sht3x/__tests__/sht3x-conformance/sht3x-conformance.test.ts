import SHT3x from 'embedded:sensor/Humidity-Temperature/SHT3x'
import Timer from 'timer'
import { assert, equal } from 'testing/assert'
import MockI2C, {
  assertMockI2CConsumed,
  getMockI2CInstances,
  prepareMockI2C,
  resetMockI2C,
  type MockI2COperation,
} from 'testing/fakes/mock-i2c'

type TestTimer = typeof Timer & {
  advance(milliseconds: number): void
  reset(): void
}

const testTimer = Timer as TestTimer
const BREAK = [0x30, 0x93] as const
const SOFT_RESET = [0x30, 0xa2] as const
const MEASURE = [0x24, 0x00] as const
const MEASUREMENT_DELAY_MILLISECONDS = 16
const SAMPLE_25C_50RH = [0x66, 0x66, 0x93, 0x80, 0x00, 0xa2] as const
const SAMPLE_MAX_MIN = [0xff, 0xff, 0xac, 0x00, 0x00, 0x81] as const

function initializationOperations(breakError?: unknown): MockI2COperation[] {
  return [
    { kind: 'write', data: BREAK, error: breakError },
    { kind: 'write', data: SOFT_RESET },
  ]
}

function sampleOperations(data: readonly number[]): MockI2COperation[] {
  return [
    { kind: 'write', data: MEASURE },
    { kind: 'read', data },
  ]
}

function expectThrows(action: () => unknown, pattern: RegExp, message: string): unknown {
  let caught: unknown
  try {
    action()
  } catch (error) {
    caught = error
  }
  assert(caught !== undefined, `${message}: expected an exception`)
  assert(pattern.test(String(caught)), `${message}: unexpected exception ${caught}`)
  return caught
}

function approximately(actual: number, expected: number, epsilon: number, message: string): void {
  assert(Math.abs(actual - expected) <= epsilon, `${message}: expected ${expected}, got ${actual}`)
}

function openSensor(
  operations: readonly MockI2COperation[],
  options: Record<string, unknown> = {},
): { io: MockI2C; sensor: SHT3x } {
  prepareMockI2C({ operations })
  const sensor = new SHT3x({
    ...options,
    sensor: Object.freeze({
      io: MockI2C,
      data: 2,
      clock: 1,
      ...((options.sensor as Record<string, unknown> | undefined) ?? {}),
    }),
  })
  const io = getMockI2CInstances().at(-1)
  assert(io !== undefined, 'SHT3x should construct its injected I2C class')
  return { io: io as MockI2C, sensor }
}

function testConstructorAndLifecycle(): void {
  resetMockI2C()
  testTimer.reset()
  const target = { name: 'environment' }
  let targetReads = 0
  const options = Object.freeze({
    get target() {
      targetReads += 1
      return target
    },
    sensor: Object.freeze({ io: MockI2C, data: 2, clock: 1 }),
  })
  prepareMockI2C({ operations: initializationOperations() })
  const sensor = new SHT3x(options)
  const io = getMockI2CInstances()[0]

  assert(io !== undefined, 'constructor should allocate I2C once')
  equal(io.options.hz, 1_000_000, 'constructor should use the TR/109 default frequency')
  equal(io.options.address, 0x44, 'constructor should use the TR/109 default address')
  equal(io.options.data, 2, 'constructor should preserve connection options')
  equal(io.options.clock, 1, 'constructor should preserve connection options')
  equal(Object.hasOwn(io.options, 'io'), false, 'constructor should not forward the I2C constructor as an option')
  equal(targetReads, 1, 'constructor should read the target option once')
  equal((sensor as SHT3x & { target: unknown }).target, target, 'constructor should expose the Base Class target')
  sensor.configure(Object.freeze({ ignored: true }))
  assertMockI2CConsumed(io)

  sensor.close()
  sensor.close()
  equal(io.closeCount, 1, 'close should be idempotent')
  expectThrows(() => sensor.sample(), /closed/, 'sample after close')
  expectThrows(() => sensor.configure({}), /closed/, 'configure after close')
}

function testConnectionOverridesAndIdleBreakFallback(): void {
  resetMockI2C()
  testTimer.reset()
  const { io, sensor } = openSensor(initializationOperations(new Error('idle NACK')), {
    sensor: { address: 0x45, hz: 400_000 },
  })
  equal(io.options.address, 0x45, 'constructor should allow an address override')
  equal(io.options.hz, 400_000, 'constructor should allow a frequency override')
  assertMockI2CConsumed(io)
  sensor.close()
}

function testSampleShapeScaleAndMeasurementSettling(): void {
  resetMockI2C()
  testTimer.reset()
  const { io, sensor } = openSensor([
    ...initializationOperations(),
    ...sampleOperations(SAMPLE_25C_50RH),
    ...sampleOperations(SAMPLE_MAX_MIN),
  ])

  let minimumSettleTimeElapsed = false
  const timer = Timer.set(() => {
    minimumSettleTimeElapsed = true
  }, MEASUREMENT_DELAY_MILLISECONDS)
  const read = io.read.bind(io)
  io.read = (buffer) => {
    equal(minimumSettleTimeElapsed, true, 'sample should wait for the maximum conversion time before reading')
    read(buffer)
  }
  const first = sensor.sample()
  Timer.clear(timer)

  assert(first !== undefined, 'a CRC-valid sample should be returned')
  approximately(first.thermometer.temperature, 25, 0.000_001, 'temperature should be converted to Celsius')
  approximately(first.hygrometer.humidity, 32_768 / 65_535, 0.000_001, 'humidity should be normalized to 0..1')
  assert(first.hygrometer.humidity >= 0 && first.hygrometer.humidity <= 1, 'humidity should be in the ECMA range')

  const second = sensor.sample()
  assert(second !== undefined, 'a second CRC-valid sample should be returned')
  equal(second.thermometer.temperature, 130, 'maximum raw temperature should convert correctly')
  equal(second.hygrometer.humidity, 0, 'minimum raw humidity should convert correctly')
  assert(first !== second, 'sample should return a fresh outer object')
  assert(first.hygrometer !== second.hygrometer, 'sample should return a fresh hygrometer object')
  assert(first.thermometer !== second.thermometer, 'sample should return a fresh thermometer object')
  assertMockI2CConsumed(io)
  sensor.close()
}

function testCrcFailureIsRecoverable(): void {
  resetMockI2C()
  testTimer.reset()
  let errorCalls = 0
  const invalid = [...SAMPLE_25C_50RH]
  invalid[5] ^= 0xff
  const { io, sensor } = openSensor(
    [...initializationOperations(), ...sampleOperations(invalid), ...sampleOperations(SAMPLE_25C_50RH)],
    {
      onError() {
        errorCalls += 1
      },
    },
  )

  equal(sensor.sample(), undefined, 'a CRC-invalid transaction should not return a partial sample')
  testTimer.advance(0)
  equal(errorCalls, 0, 'a recoverable CRC failure should not invoke onError')
  assert(sensor.sample() !== undefined, 'the sensor should remain usable after a CRC failure')
  assertMockI2CConsumed(io)
  sensor.close()
}

function testIoFailureQueuesOnErrorAndPoisonsInstance(): void {
  resetMockI2C()
  testTimer.reset()
  const readFailure = new Error('injected read failure')
  let callbackThis: unknown
  let callbackArguments = -1
  const { io, sensor } = openSensor(
    [...initializationOperations(), { kind: 'write', data: MEASURE }, { kind: 'read', error: readFailure }],
    {
      onError(this: SHT3x, ...args: unknown[]) {
        callbackThis = this
        callbackArguments = args.length
      },
    },
  )

  const caught = expectThrows(() => sensor.sample(), /injected read failure/, 'I2C read failure')
  equal(caught, readFailure, 'sample should rethrow the original I2C exception')
  equal(callbackArguments, -1, 'onError should not run inside sample')
  expectThrows(() => sensor.sample(), /failed/, 'sample after a non-recoverable error')
  expectThrows(() => sensor.configure({}), /failed/, 'configure after a non-recoverable error')
  testTimer.advance(0)
  equal(callbackThis, sensor, 'onError should run with the sensor as this')
  equal(callbackArguments, 0, 'onError should not receive implementation-specific arguments')
  assertMockI2CConsumed(io)
  sensor.close()

  resetMockI2C()
  testTimer.reset()
  let cancelledCalls = 0
  const cancelled = openSensor(
    [
      ...initializationOperations(),
      { kind: 'write', data: MEASURE },
      { kind: 'read', error: new Error('close before callback') },
    ],
    {
      onError() {
        cancelledCalls += 1
      },
    },
  )
  expectThrows(() => cancelled.sensor.sample(), /close before callback/, 'queued callback cancellation')
  cancelled.sensor.close()
  testTimer.advance(0)
  equal(cancelledCalls, 0, 'close should cancel a pending onError callback')
  assertMockI2CConsumed(cancelled.io)
}

function testConstructorValidationAndCleanup(): void {
  resetMockI2C()
  testTimer.reset()
  expectThrows(() => new SHT3x(undefined), /options/, 'missing options')
  expectThrows(() => new SHT3x({}), /sensor/, 'missing sensor connection')
  expectThrows(() => new SHT3x({ sensor: {} }), /sensor\.io/, 'missing I2C constructor')
  expectThrows(() => new SHT3x({ sensor: { io: MockI2C }, onError: 'invalid' }), /onError/, 'invalid onError callback')
  equal(getMockI2CInstances().length, 0, 'validation should finish before allocating I2C')

  const resetFailure = new Error('soft reset failed')
  prepareMockI2C({
    operations: [
      { kind: 'write', data: BREAK },
      { kind: 'write', data: SOFT_RESET, error: resetFailure },
    ],
  })
  const caught = expectThrows(
    () => new SHT3x({ sensor: { io: MockI2C, data: 2, clock: 1 } }),
    /soft reset failed/,
    'constructor reset failure',
  )
  equal(caught, resetFailure, 'constructor should preserve the original initialization exception')
  const io = getMockI2CInstances()[0]
  assert(io !== undefined, 'constructor should have allocated I2C before reset failure')
  equal(io.closeCount, 1, 'constructor failure should close allocated I2C')
  assertMockI2CConsumed(io)
}

testConstructorAndLifecycle()
testConnectionOverridesAndIdleBreakFallback()
testSampleShapeScaleAndMeasurementSettling()
testCrcFailureIsRecoverable()
testIoFailureQueuesOnErrorAndPoisonsInstance()
testConstructorValidationAndCleanup()
trace('ok\n')
