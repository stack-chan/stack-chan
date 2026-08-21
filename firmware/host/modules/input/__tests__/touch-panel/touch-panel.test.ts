import type { TouchPanelInputEvent } from 'input-event'
import { assert, equal } from 'testing/assert'
import Time from 'time'
import Timer from 'timer'
import TouchPanel from 'touch-panel'

class FakeTouchPanelDriver {
  static current: FakeTouchPanelDriver | undefined

  closed = false
  sampleCount = 0
  #samples: number[][] = []

  constructor(_options: unknown) {
    FakeTouchPanelDriver.current = this
  }

  sample(): number[] {
    this.sampleCount += 1
    return this.#samples.shift() ?? []
  }

  queue(...samples: number[][]): void {
    this.#samples.push(...samples)
  }

  close(): void {
    this.closed = true
  }
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => Timer.set(() => resolve(), milliseconds))
}

async function waitForSampleCount(driver: FakeTouchPanelDriver, count: number): Promise<void> {
  const deadline = Time.ticks + 500
  while (driver.sampleCount < count) {
    assert(Time.ticks < deadline, `TouchPanel should poll at least ${count} samples`)
    await wait(5)
  }
}

function assertPressAndRelease(events: TouchPanelInputEvent[], label: string): void {
  equal(events.length, 2, `${label} should receive two events`)
  equal(events[0].gesture, 'press', `${label} should receive press first`)
  equal(events[1].gesture, 'release', `${label} should receive release second`)
}

async function runTest(): Promise<void> {
  FakeTouchPanelDriver.current = undefined
  const touchPanel = new TouchPanel(FakeTouchPanelDriver, { interval: 10 })
  const driver = FakeTouchPanelDriver.current
  assert(driver, 'TouchPanel should instantiate its driver')

  const legacyEvents: TouchPanelInputEvent[] = []
  const subscriberEvents: TouchPanelInputEvent[] = []
  const survivingEvents: TouchPanelInputEvent[] = []
  touchPanel.onEvent = (event) => legacyEvents.push(event)
  touchPanel.subscribe(() => {
    throw new Error('injected listener failure')
  })
  const unsubscribe = touchPanel.subscribe((event) => subscriberEvents.push(event))
  touchPanel.subscribe((event) => survivingEvents.push(event))

  driver.queue([0, 1, 0], [0, 0, 0])
  touchPanel.start()
  await waitForSampleCount(driver, 2)

  assertPressAndRelease(legacyEvents, 'legacy onEvent')
  assertPressAndRelease(subscriberEvents, 'subscriber')
  assertPressAndRelease(survivingEvents, 'surviving subscriber')
  const tap = subscriberEvents[1].tap
  assert(tap, 'release should include tap details')
  assert(tap.durationMs >= 0 && tap.durationMs <= 300, 'tap duration should remain inside the recognizer limit')
  equal(tap.maxMovement, 0, 'stable tap should not report movement')
  equal(tap.position, 0, 'center tap should report center position')

  unsubscribe()
  driver.queue([1, 0, 0], [0, 0, 0])
  await waitForSampleCount(driver, 4)

  equal(subscriberEvents.length, 2, 'unsubscribe should stop only the selected listener')
  equal(legacyEvents.length, 4, 'legacy onEvent should remain compatible')
  equal(survivingEvents.length, 4, 'another subscriber should continue receiving events')

  touchPanel.close()
  const samplesAfterClose = driver.sampleCount
  driver.queue([0, 1, 0])
  await wait(30)
  equal(driver.sampleCount, samplesAfterClose, 'close should stop polling')
  equal(survivingEvents.length, 4, 'close should stop sampling and clear subscribers')
  equal(driver.closed, true, 'close should release the touch panel driver')

  trace('ok\n')
}

runTest().catch((error) => {
  trace(`TouchPanel test failed: ${String(error)}\n`)
  throw error
})
