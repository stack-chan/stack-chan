import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { writeAliasPackage, writeAliasPackageSubpath } from '../../testing/node-alias-package.js'
import type { TouchInputEvent } from '../input-event.js'

type FakeTimer = {
  advance(milliseconds: number): void
  reset(): void
}

type FakeConfig = {
  resetConfig(values?: Record<string, unknown>): void
}

type TouchSample = Array<{ id: number; x: number; y: number }>

class FakeTouchDriver {
  static current: FakeTouchDriver | undefined

  configuration = { interrupt: true }
  points: Array<{ x: number; y: number } | undefined> = []
  #onSample: () => void
  #samples: Array<TouchSample | undefined> = []

  constructor(options: unknown) {
    this.#onSample = (options as { onSample: () => void }).onSample
    FakeTouchDriver.current = this
  }

  sample(): TouchSample | undefined {
    return this.#samples.shift()
  }

  emit(sample: TouchSample | undefined): void {
    this.#samples.push(sample)
    this.#onSample()
  }
}

function installBareSpecifierPackages(): void {
  const modulesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
  writeAliasPackage(modulesRoot, 'input-event', resolve(modulesRoot, 'input/input-event.js'))
  writeAliasPackage(modulesRoot, 'timer', resolve(modulesRoot, 'testing/fakes/timer.js'), { hasDefaultExport: true })
  writeAliasPackage(modulesRoot, 'time', resolve(modulesRoot, 'testing/fakes/time.js'), { hasDefaultExport: true })
  writeAliasPackageSubpath(modulesRoot, 'mc', 'config', resolve(modulesRoot, 'testing/fakes/mc-config.js'), {
    hasDefaultExport: true,
  })
}

async function createTouch(configValues: Record<string, unknown>) {
  installBareSpecifierPackages()
  const [{ default: Touch }, { default: fakeTimer }, { resetConfig }] = await Promise.all([
    import('../touch.js'),
    import('timer') as Promise<{ default: FakeTimer }>,
    import('../../testing/fakes/mc-config.js') as Promise<FakeConfig>,
  ])

  fakeTimer.reset()
  resetConfig(configValues)
  FakeTouchDriver.current = undefined
  ;(globalThis as typeof globalThis & { trace: (...messages: unknown[]) => void }).trace = () => {}

  const events: TouchInputEvent[] = []
  const touch = new Touch(FakeTouchDriver)
  touch.onEvent = (event) => events.push(event)

  assert.ok(FakeTouchDriver.current)
  return { driver: FakeTouchDriver.current, events, fakeTimer }
}

test('Touch emits ended immediately when release debounce is disabled', async () => {
  const { driver, events } = await createTouch({ touchCount: 1 })

  driver.emit([{ id: 0, x: 10, y: 20 }])
  driver.emit([])

  assert.deepEqual(
    events.map((event) => event.phase),
    ['began', 'ended'],
  )
})

test('Touch suppresses one transient empty sample while touch is active', async () => {
  const { driver, events, fakeTimer } = await createTouch({ touchCount: 1, touchReleaseDebounceMs: 75 })

  driver.emit([{ id: 0, x: 10, y: 20 }])
  driver.emit([])
  fakeTimer.advance(50)
  driver.emit([{ id: 0, x: 12, y: 22 }])
  fakeTimer.advance(100)

  assert.deepEqual(
    events.map((event) => event.phase),
    ['began', 'moved'],
  )
})

test('Touch emits pending ended when the empty sample is a real release', async () => {
  const { driver, events, fakeTimer } = await createTouch({ touchCount: 1, touchReleaseDebounceMs: 75 })

  driver.emit([{ id: 0, x: 10, y: 20 }])
  driver.emit([{ id: 0, x: 12, y: 22 }])
  driver.emit([])
  fakeTimer.advance(74)
  assert.deepEqual(
    events.map((event) => event.phase),
    ['began', 'moved'],
  )

  fakeTimer.advance(1)

  assert.deepEqual(events.at(-1), {
    kind: 'touch',
    phase: 'ended',
    id: 0,
    x: 12,
    y: 22,
    ticks: 0,
  })
})
