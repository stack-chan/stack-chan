import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

const stackchanManifest = JSON.parse(readFileSync('stackchan/manifest.json', 'utf8'))
const m5StackChanPlatformManifest = JSON.parse(readFileSync('platforms/m5stackchan_cores3/manifest.json', 'utf8'))
const m5StackChanStackchanManifest = JSON.parse(readFileSync('stackchan/manifest_m5stackchan_cores3.json', 'utf8'))

describe('Stack-chan platform manifest', () => {
  test('gives M5StackChan CoreS3 the same expandable XS creation heap as CoreS3', () => {
    const coreS3Creation = stackchanManifest.platforms['esp32/m5stack_cores3'].creation
    const m5StackChanCoreS3Creation = stackchanManifest.platforms['esp32/m5stackchan_cores3']?.creation

    assert.deepEqual(m5StackChanCoreS3Creation, coreS3Creation)
    assert.equal(m5StackChanCoreS3Creation.heap.incremental, 256)
  })

  test('keeps M5StackChan CoreS3 platform wiring on the PY32 servo power and head LED paths', () => {
    assert.deepEqual(m5StackChanPlatformManifest.include, [
      '$(BUILD)/devices/esp32/targets/m5stack_cores3/manifest.json',
      '$(MODDABLE)/modules/drivers/sensors/si12t/manifest.json',
    ])
    assert.equal(m5StackChanPlatformManifest.config.driver.type, 'm5stackchan')
    assert.deepEqual(m5StackChanPlatformManifest.config.driver.serial, {
      transmit: 6,
      receive: 7,
      port: 1,
      baud: 1000000,
    })
    assert.deepEqual(m5StackChanPlatformManifest.config.driver.servoPower, {
      type: 'py32',
      pin: 0,
      address: 111,
    })
    assert.deepEqual(m5StackChanPlatformManifest.config.led.head, {
      type: 'py32',
      length: 12,
      ledPin: 13,
      address: 111,
    })
  })

  test('provides a M5StackChan CoreS3 smoke MOD with no private config', () => {
    const smokeManifest = JSON.parse(readFileSync('mods/m5stackchan_smoke/manifest.json', 'utf8'))
    const smokeSource = readFileSync('mods/m5stackchan_smoke/mod.js', 'utf8')
    const smokeDocs = readFileSync('docs/m5stackchan-cores3-smoke.md', 'utf8')

    assert.deepEqual(m5StackChanStackchanManifest.include, ['./manifest.json'])
    assert.equal(m5StackChanStackchanManifest.config.driver.type, 'm5stackchan')
    assert.equal(m5StackChanStackchanManifest.config.driver.serial.transmit, 6)
    assert.equal(m5StackChanStackchanManifest.config.driver.serial.receive, 7)

    assert.deepEqual(smokeManifest.include, ['$(MODDABLE)/examples/manifest_mod.json'])
    assert.deepEqual(smokeManifest.modules, { '*': ['./mod'] })
    assert.equal(smokeManifest.config, undefined)

    for (const api of ['lightOn', 'lightBlink', 'lightRainbow', 'lightOff', 'setTorque', 'setPose']) {
      assert.match(smokeSource, new RegExp(`robot\\.${api}\\b`), `smoke MOD should exercise robot.${api}`)
    }
    assert.match(smokeSource, /M5StackChan CoreS3 smoke/)
    assert.match(smokeDocs, /esp32:\.\/platforms\/m5stackchan_cores3/)
    assert.match(smokeDocs, /stackchan\/manifest_m5stackchan_cores3\.json/)
    assert.match(smokeDocs, /mods\/m5stackchan_smoke\/manifest\.json/)
  })
})
