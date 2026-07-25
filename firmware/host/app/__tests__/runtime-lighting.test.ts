import assert from 'node:assert/strict'
import { test } from 'node:test'

import { StackchanRuntimeLighting } from '../runtime-lighting.js'

function fakeLed() {
  const led = {
    offCount: 0,
    onCalls: [] as Array<[number, number, number, number?, number?, number?]>,
    offCalls: [] as Array<[number?, number?]>,
    on: (r: number, g: number, b: number, duration?: number, index?: number, count?: number) => {
      led.onCalls.push([r, g, b, duration, index, count])
    },
    off: (index?: number, count?: number) => {
      led.offCount += 1
      led.offCalls.push([index, count])
    },
    blink: () => {},
    rainbow: () => {},
  }
  return led
}

test('StackchanRuntimeLighting close turns off every LED', () => {
  const face = fakeLed()
  const base = fakeLed()
  const runtime = new StackchanRuntimeLighting({ led: { face, base } })

  runtime.close()

  assert.equal(face.offCount, 1)
  assert.equal(base.offCount, 1)
})

test('StackchanRuntimeLighting close keeps turning off LEDs when one fails', () => {
  const failing = {
    on: () => {},
    off: () => {
      throw new Error('led failure')
    },
    blink: () => {},
    rainbow: () => {},
  }
  const base = fakeLed()
  const runtime = new StackchanRuntimeLighting({ led: { failing, base } })

  runtime.close()

  assert.equal(base.offCount, 1)
})

test('StackchanRuntimeLighting restores the manual LED command after an Interaction lease', () => {
  let now = 100
  const head = fakeLed()
  const runtime = new StackchanRuntimeLighting({ led: { head } }, { now: () => now })
  runtime.lightOn('head', 10, 20, 30, 1000, 1, 2)
  const manual = runtime.snapshotManualCommand('head')

  runtime.applyInteractionColor('head', 255, 0, 64)
  now = 500
  runtime.restoreManualCommand('head', manual)

  assert.deepEqual(head.onCalls[head.onCalls.length - 1], [10, 20, 30, 600, 1, 2])
})

test('StackchanRuntimeLighting does not revive an expired manual command', () => {
  let now = 100
  const head = fakeLed()
  const runtime = new StackchanRuntimeLighting({ led: { head } }, { now: () => now })
  runtime.lightOn('head', 10, 20, 30, 1000, 1, 2)
  const manual = runtime.snapshotManualCommand('head')

  now = 1100
  runtime.restoreManualCommand('head', manual)

  assert.deepEqual(head.offCalls[head.offCalls.length - 1], [1, 2])
})
