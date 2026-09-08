import IMU from 'imu'
import { assert, equal } from 'testing/assert'
import Timer from 'timer'
import Touch from 'touch'

async function run() {
  const initFailure = new Error('configure failed')
  let imuCloses = 0
  class FailingIMU {
    configure() {
      throw initFailure
    }
    sample() {
      return {}
    }
    close() {
      imuCloses += 1
      throw new Error('close failed')
    }
  }
  let failure: unknown
  try {
    new IMU(FailingIMU)
  } catch (error) {
    failure = error
  }
  equal(failure, initFailure, 'IMU preserves configuration failure')
  equal(imuCloses, 1, 'IMU configuration failure releases the acquired input')

  let touchCloses = 0
  let sampleCalls = 0
  let lateSample: () => void
  class Input {
    points = []
    constructor(options: { onSample: () => void }) {
      lateSample = options.onSample
    }
    get configuration(): { interrupt: boolean } {
      throw initFailure
    }
    sample() {
      sampleCalls += 1
      return []
    }
    close() {
      touchCloses += 1
    }
  }
  failure = undefined
  try {
    new Touch(Input)
  } catch (error) {
    failure = error
  }
  equal(failure, initFailure, 'touch preserves setup failure')
  equal(touchCloses, 1, 'touch setup failure releases the acquired input')
  lateSample()
  equal(sampleCalls, 0, 'an interrupt retained by the failed driver cannot sample after close')

  class PollingInput extends Input {
    get configuration() {
      return { interrupt: false }
    }
  }
  const touch = new Touch(PollingInput, { intervalMs: 5 })
  await new Promise<void>((resolve) => Timer.set(() => resolve(), 20))
  assert(sampleCalls > 0, 'touch polls the driver before close')
  touch.close()
  touch.close()
  equal(touchCloses, 2, 'normal close releases the second input once')
  const count = sampleCalls
  lateSample()
  await new Promise<void>((resolve) => Timer.set(() => resolve(), 20))
  equal(sampleCalls, count, 'polls and late interrupts are stopped')

  let unsupportedCloses = 0
  let unsupportedReads = 0
  class ReadInput {
    points = []
    read() {
      unsupportedReads++
    }
    close() {
      unsupportedCloses++
    }
  }
  failure = undefined
  try {
    new Touch(ReadInput as unknown as ConstructorParameters<typeof Touch>[0])
  } catch (error) {
    failure = error
  }
  assert(failure, 'drivers without sample() are rejected')
  equal(unsupportedCloses, 1, 'unsupported drivers release the acquired input')
  await new Promise<void>((resolve) => Timer.set(() => resolve(), 20))
  equal(unsupportedReads, 0, 'the retired read() polling path is not started')
  trace('ok\n')
}
run().catch((error) => {
  trace(`input lifecycle failed: ${String(error)}\n`)
  throw error
})
