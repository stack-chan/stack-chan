import assert from 'node:assert/strict'
import { test } from 'node:test'

import { installRuntimeTestAliases } from './runtime-test-aliases.js'

installRuntimeTestAliases()
const { StackchanRuntimeLighting } = await import('../runtime-lighting.js')

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

test('StackchanRuntimeLighting close turns off every LED', async () => {
  const face = fakeLed()
  const base = fakeLed()
  const runtime = new StackchanRuntimeLighting({ led: { face, base } })

  await runtime.close()

  assert.equal(face.offCount, 1)
  assert.equal(base.offCount, 1)
})

test('StackchanRuntimeLighting close keeps turning off LEDs when one fails', async () => {
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

  await assert.rejects(runtime.close(), /led failure/)

  assert.equal(base.offCount, 1)
})

test('lighting releases native output once and rejects effects after close', async () => {
  const led = {
    ...fakeLed(),
    closeCount: 0,
    close() {
      this.closeCount += 1
    },
  }
  const runtime = new StackchanRuntimeLighting({ led: { face: led } })
  const closing = runtime.close()
  assert.equal(closing, runtime.close())
  await closing
  assert.equal(led.closeCount, 1)
  assert.throws(() => runtime.lightOn('face', 1, 2, 3), { code: 'CLOSED' })
  assert.throws(() => runtime.lightBlink('face', 1, 2, 3, 100), { code: 'CLOSED' })
})
