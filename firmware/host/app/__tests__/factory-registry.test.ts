import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'

import type { RobotUI, TTS } from 'capabilities'
import type { MotionDriver } from 'motion-controller'
import {
  clearFactoryRegistryForTest,
  getMotionDriverFactory,
  getTTSFactory,
  getUIFactory,
  listMotionDriverFactoryTypes,
  listTTSFactoryTypes,
  listUIFactoryTypes,
  registerMotionDriverFactory,
  registerTTSFactory,
  registerUIFactory,
} from '../factory-registry/registry.js'

afterEach(() => {
  clearFactoryRegistryForTest()
})

test('factory registries resolve only explicitly registered implementations', () => {
  const driver = { setTorque: () => {} } as unknown as MotionDriver
  const tts = { stream: () => {} } as unknown as TTS
  const ui = { close: () => {} } as unknown as RobotUI

  registerMotionDriverFactory('test-driver', () => driver)
  registerTTSFactory('test-tts', () => tts)
  registerUIFactory('test-ui', () => ui)

  assert.equal(getMotionDriverFactory('test-driver')?.({}), driver)
  assert.equal(getTTSFactory('test-tts')?.({}), tts)
  assert.equal(getUIFactory('test-ui')?.({}), ui)
  assert.equal(getMotionDriverFactory('missing'), undefined)
  assert.equal(getTTSFactory('missing'), undefined)
  assert.equal(getUIFactory('missing'), undefined)
})

test('factory registries expose registered types for diagnostics', () => {
  registerMotionDriverFactory('driver-a', () => ({}) as MotionDriver)
  registerTTSFactory('tts-a', () => ({}) as TTS)
  registerUIFactory('ui-a', () => ({}) as RobotUI)

  assert.deepEqual(listMotionDriverFactoryTypes(), ['driver-a'])
  assert.deepEqual(listTTSFactoryTypes(), ['tts-a'])
  assert.deepEqual(listUIFactoryTypes(), ['ui-a'])
})

test('factory registries reject duplicate type registration', () => {
  registerMotionDriverFactory('duplicate', () => ({}) as MotionDriver)

  assert.throws(
    () => registerMotionDriverFactory('duplicate', () => ({}) as MotionDriver),
    /motion driver type "duplicate" is already registered/,
  )
})
