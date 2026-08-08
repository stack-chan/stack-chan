import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { writeAliasPackage } from '../../testing/node-alias-package.js'
import type { IMUSample } from '../imu-motion.js'

type FakeTimer = {
  advance(milliseconds: number): void
  reset(): void
}

class FakeIMUDriver {
  static current: FakeIMUDriver | undefined
  #samples: Array<IMUSample | Error> = []

  constructor(_options: unknown) {
    FakeIMUDriver.current = this
  }

  configure(_options: unknown): void {}

  sample(): IMUSample {
    const sample = this.#samples.shift() ?? {}
    if (sample instanceof Error) throw sample
    return sample
  }

  queue(sample: IMUSample | Error): void {
    this.#samples.push(sample)
  }
}

function installBareSpecifierPackages(): void {
  const modulesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
  writeAliasPackage(modulesRoot, 'imu-motion', resolve(modulesRoot, 'input/imu-motion.js'))
  writeAliasPackage(modulesRoot, 'input-event', resolve(modulesRoot, 'input/input-event.js'))
  writeAliasPackage(modulesRoot, 'timer', resolve(modulesRoot, 'testing/fakes/timer.js'), { hasDefaultExport: true })
  writeAliasPackage(modulesRoot, 'time', resolve(modulesRoot, 'testing/fakes/time.js'), { hasDefaultExport: true })
}

async function setup() {
  installBareSpecifierPackages()
  const [{ default: IMU }, { default: fakeTimer }] = await Promise.all([
    import('../imu.js'),
    import('timer') as Promise<{ default: FakeTimer }>,
  ])
  fakeTimer.reset()
  FakeIMUDriver.current = undefined
  ;(globalThis as typeof globalThis & { trace: (...messages: unknown[]) => void }).trace = () => {}
  const imu = new IMU(FakeIMUDriver, { interval: 10 })
  assert.ok(FakeIMUDriver.current)
  return { imu, driver: FakeIMUDriver.current, fakeTimer }
}

test('IMU exposes a defensive copy of the latest successful sample', async () => {
  const { imu, driver, fakeTimer } = await setup()
  assert.deepEqual(imu.lastSample, {})

  driver.queue({
    accelerometer: { x: 1, y: 2, z: 3 },
    gyroscope: { x: 4, y: 5, z: 6 },
  })
  imu.start()
  fakeTimer.advance(10)

  const sample = imu.lastSample
  assert.deepEqual(sample, {
    accelerometer: { x: 1, y: 2, z: 3 },
    gyroscope: { x: 4, y: 5, z: 6 },
  })
  if (sample.accelerometer) sample.accelerometer.x = 99
  assert.equal(imu.lastSample.accelerometer?.x, 1)

  driver.queue(new Error('temporary read failure'))
  fakeTimer.advance(10)
  assert.equal(imu.lastSample.accelerometer?.x, 1)
  imu.close()
})
