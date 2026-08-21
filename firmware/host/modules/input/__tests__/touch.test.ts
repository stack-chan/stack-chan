import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { writeAliasPackage } from '../../testing/node-alias-package.js'
import type { TouchInputEvent, TouchPanelInputEvent } from '../input-event.js'

type FakeTimer = {
  advance(milliseconds: number): void
  reset(): void
}

type FakeTime = {
  reset(): void
  setTicks(ticks: number): void
}

type TouchSample = Array<{ id: number; x: number; y: number }>
type TouchOptions = {
  count?: number
  intervalMs?: number
  idleIntervalMs?: number
  activeIntervalMs?: number
  releaseDebounceMs?: number
}

class FakeTouchDriver {
  static current: FakeTouchDriver | undefined
  static interrupt = true

  configuration = { interrupt: FakeTouchDriver.interrupt }
  points: Array<{ x: number; y: number } | undefined> = []
  sampleCount = 0
  #onSample: () => void
  #samples: Array<TouchSample | undefined> = []

  constructor(options: unknown) {
    this.#onSample = (options as { onSample: () => void }).onSample
    FakeTouchDriver.current = this
  }

  sample(): TouchSample | undefined {
    this.sampleCount += 1
    return this.#samples.shift()
  }

  queue(sample: TouchSample | undefined): void {
    this.#samples.push(sample)
  }

  emit(sample: TouchSample | undefined): void {
    this.#samples.push(sample)
    this.#onSample()
  }
}

class FakeTouchPanelDriver {
  static current: FakeTouchPanelDriver | undefined

  closed = false
  #samples: number[][] = []

  constructor(_options: unknown) {
    FakeTouchPanelDriver.current = this
  }

  sample(): number[] {
    return this.#samples.shift() ?? []
  }

  queue(sample: number[]): void {
    this.#samples.push(sample)
  }

  close(): void {
    this.closed = true
  }
}

function installBareSpecifierPackages(): void {
  const modulesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
  writeAliasPackage(modulesRoot, 'input-event', resolve(modulesRoot, 'input/input-event.js'))
  writeAliasPackage(modulesRoot, 'touch-panel-gesture', resolve(modulesRoot, 'input/touch-panel-gesture.js'))
  writeAliasPackage(modulesRoot, 'timer', resolve(modulesRoot, 'testing/fakes/timer.js'), { hasDefaultExport: true })
  writeAliasPackage(modulesRoot, 'time', resolve(modulesRoot, 'testing/fakes/time.js'), { hasDefaultExport: true })
}

async function createTouch(options: TouchOptions, driverOptions: { interrupt?: boolean } = {}) {
  installBareSpecifierPackages()
  const [{ default: Touch }, { default: fakeTimer }] = await Promise.all([
    import('../touch.js'),
    import('timer') as Promise<{ default: FakeTimer }>,
  ])

  fakeTimer.reset()
  FakeTouchDriver.interrupt = driverOptions.interrupt ?? true
  FakeTouchDriver.current = undefined
  ;(globalThis as typeof globalThis & { trace: (...messages: unknown[]) => void }).trace = () => {}

  const events: TouchInputEvent[] = []
  const touch = new Touch(FakeTouchDriver, options)
  touch.onEvent = (event) => events.push(event)

  assert.ok(FakeTouchDriver.current)
  return { driver: FakeTouchDriver.current, events, fakeTimer }
}

async function createTouchPanel() {
  installBareSpecifierPackages()
  const [{ default: TouchPanel }, { default: fakeTimer }, { default: fakeTime }] = await Promise.all([
    import('../touch-panel.js'),
    import('timer') as Promise<{ default: FakeTimer }>,
    import('time') as Promise<{ default: FakeTime }>,
  ])

  fakeTimer.reset()
  fakeTime.reset()
  FakeTouchPanelDriver.current = undefined
  ;(globalThis as typeof globalThis & { trace: (...messages: unknown[]) => void }).trace = () => {}

  const touchPanel = new TouchPanel(FakeTouchPanelDriver, { interval: 10 })
  assert.ok(FakeTouchPanelDriver.current)
  return { driver: FakeTouchPanelDriver.current, fakeTime, fakeTimer, touchPanel }
}

test('Touch emits ended immediately when release debounce is disabled', async () => {
  const { driver, events } = await createTouch({ count: 1 })

  driver.emit([{ id: 0, x: 10, y: 20 }])
  driver.emit([])

  assert.deepEqual(
    events.map((event) => event.phase),
    ['began', 'ended'],
  )
})

test('Touch suppresses one transient empty sample while touch is active', async () => {
  const { driver, events, fakeTimer } = await createTouch({ count: 1, releaseDebounceMs: 75 })

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
  const { driver, events, fakeTimer } = await createTouch({ count: 1, releaseDebounceMs: 75 })

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

test('Touch switches ECMA-419 polling from idle to active interval while a point is tracked', async () => {
  const { driver, events, fakeTimer } = await createTouch(
    { count: 1, idleIntervalMs: 50, activeIntervalMs: 8, releaseDebounceMs: 75 },
    { interrupt: false },
  )

  driver.queue([])
  fakeTimer.advance(49)
  assert.equal(driver.sampleCount, 0)
  fakeTimer.advance(1)
  assert.equal(driver.sampleCount, 1)

  driver.queue([{ id: 0, x: 10, y: 20 }])
  fakeTimer.advance(50)
  assert.equal(driver.sampleCount, 2)

  driver.queue([{ id: 0, x: 11, y: 21 }])
  fakeTimer.advance(7)
  assert.equal(driver.sampleCount, 2)
  fakeTimer.advance(1)
  assert.equal(driver.sampleCount, 3)

  driver.queue([])
  fakeTimer.advance(8)
  fakeTimer.advance(74)
  assert.deepEqual(
    events.map((event) => event.phase),
    ['began', 'moved'],
  )
  fakeTimer.advance(1)
  assert.equal(events.at(-1)?.phase, 'ended')
})

test('TouchPanel fans out tap events without replacing petting subscribers', async () => {
  const { driver, fakeTime, fakeTimer, touchPanel } = await createTouchPanel()
  const legacyEvents: TouchPanelInputEvent[] = []
  const subscriberEvents: TouchPanelInputEvent[] = []
  const survivingEvents: TouchPanelInputEvent[] = []
  touchPanel.onEvent = (event) => legacyEvents.push(event)
  touchPanel.subscribe(() => {
    throw new Error('injected listener failure')
  })
  const unsubscribe = touchPanel.subscribe((event) => subscriberEvents.push(event))
  touchPanel.subscribe((event) => survivingEvents.push(event))
  touchPanel.start()

  driver.queue([0, 1, 0])
  fakeTime.setTicks(100)
  fakeTimer.advance(10)
  driver.queue([0, 0, 0])
  fakeTime.setTicks(250)
  fakeTimer.advance(10)

  assert.deepEqual(
    legacyEvents.map((event) => event.gesture),
    ['press', 'release'],
  )
  assert.deepEqual(
    subscriberEvents.map((event) => event.gesture),
    ['press', 'release'],
  )
  assert.deepEqual(
    survivingEvents.map((event) => event.gesture),
    ['press', 'release'],
  )
  assert.deepEqual(subscriberEvents.at(-1)?.tap, {
    durationMs: 150,
    maxMovement: 0,
    position: 0,
  })

  unsubscribe()
  driver.queue([1, 0, 0])
  fakeTime.setTicks(300)
  fakeTimer.advance(10)
  driver.queue([0, 0, 0])
  fakeTime.setTicks(350)
  fakeTimer.advance(10)

  assert.equal(subscriberEvents.length, 2, 'unsubscribe should stop only the selected listener')
  assert.equal(legacyEvents.length, 4, 'legacy onEvent should remain compatible')
  assert.equal(survivingEvents.length, 4, 'another subscriber should continue receiving events')

  touchPanel.close()
  driver.queue([0, 1, 0])
  fakeTime.setTicks(400)
  fakeTimer.advance(10)
  assert.equal(survivingEvents.length, 4, 'close should stop sampling and clear subscribers')
  assert.equal(driver.closed, true, 'close should release the touch panel driver')
})
