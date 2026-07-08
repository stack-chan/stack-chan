import assert from 'node:assert/strict'
import { test } from 'node:test'

import { StackchanRuntimeLighting } from '../runtime-lighting.js'

function fakeLed() {
  const led = {
    offCount: 0,
    on: () => {},
    off: () => {
      led.offCount += 1
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
