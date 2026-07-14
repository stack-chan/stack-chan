import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

const stackchanAppManifest = JSON.parse(readFileSync('host/app/manifest.json', 'utf8'))
const esp32PlatformManifest = JSON.parse(readFileSync('host/platforms/esp32/manifest.json', 'utf8'))
const m5StackChanPlatformManifest = JSON.parse(readFileSync('host/platforms/m5stackchan_cores3/manifest.json', 'utf8'))
const m5StackChanStackchanManifest = JSON.parse(readFileSync('host/app/manifest_m5stackchan_cores3.json', 'utf8'))
const m5StackChanProviderSource = readFileSync('host/platforms/m5stackchan_cores3/host/provider.js', 'utf8')
const m5StackChanTouchSource = readFileSync(
  'host/platforms/m5stackchan_cores3/host/ft6206_async_m5stackchan.js',
  'utf8',
)
const coreS3AudioOutSource = readFileSync('host/platforms/core_s3_audioout.js', 'utf8')
const stackchanRtPlatformManifest = JSON.parse(readFileSync('host/platforms/stackchan_rt/manifest.json', 'utf8'))
const stackchanRtAppManifest = JSON.parse(readFileSync('host/app/manifest_stackchan_rt.json', 'utf8'))
const takaoPlatformManifest = JSON.parse(readFileSync('host/platforms/takao_core2_sg90/manifest.json', 'utf8'))
const takaoAppManifest = JSON.parse(readFileSync('host/app/manifest_takao_core2_sg90.json', 'utf8'))
const takaoProviderSource = readFileSync('host/platforms/takao_core2_sg90/host/provider.js', 'utf8')
const packageJson = JSON.parse(readFileSync('package.json', 'utf8'))

function npmRunScripts(source: string): string[] {
  return Array.from(source.matchAll(/\bnpm run ([\w:-]+)/g), ([, script]) => script)
}

describe('Stack-chan platform manifest', () => {
  test('gives M5StackChan CoreS3 the same expandable XS creation heap as CoreS3', () => {
    assert.ok(stackchanAppManifest.include.includes('../platforms/esp32/manifest.json'))
    assert.ok(stackchanAppManifest.include.includes('../platforms/lin/manifest.json'))

    const coreS3Creation = esp32PlatformManifest.platforms['esp32/m5stack_cores3'].creation
    const m5StackChanCoreS3Creation = esp32PlatformManifest.platforms['esp32/m5stackchan_cores3']?.creation

    assert.deepEqual(m5StackChanCoreS3Creation, coreS3Creation)
    assert.equal(m5StackChanCoreS3Creation.heap.incremental, 256)

    // stackchan_rt is a SUBPLATFORM build (fullplatform "esp32/stackchan_rt"); without its own
    // platforms entry it would inherit the target's fixed-size heap and abort with "memory full".
    const stackchanRtCreation = esp32PlatformManifest.platforms['esp32/stackchan_rt']?.creation
    assert.deepEqual(stackchanRtCreation, coreS3Creation)
    assert.equal(stackchanRtCreation.heap.incremental, 256)
    assert.equal(stackchanRtCreation.keys.incremental, 32)

    const core2Creation = esp32PlatformManifest.platforms['esp32/m5stack_core2'].creation
    const takaoCreation = esp32PlatformManifest.platforms['esp32/takao_core2_sg90']?.creation
    assert.deepEqual(takaoCreation, core2Creation)
    assert.equal(takaoCreation.keys.available, 512)
  })

  test('keeps M5StackChan CoreS3 platform wiring on the PY32 servo power and head LED paths', () => {
    assert.deepEqual(m5StackChanPlatformManifest.include, [
      '$(BUILD)/devices/esp32/targets/m5stack_cores3/manifest.json',
      '$(MODDABLE)/modules/drivers/sensors/si12t/manifest.json',
    ])
    assert.equal(esp32PlatformManifest.platforms['esp32/m5stack_cores3'].config.touchReleaseDebounceMs, 75)
    assert.equal(esp32PlatformManifest.platforms['esp32/m5stack_cores3'].defines.ft6206.hz, 400000)
    assert.equal(m5StackChanPlatformManifest.config.touchReleaseDebounceMs, 75)
    assert.equal(m5StackChanPlatformManifest.config.touchIdleIntervalMs, 50)
    assert.equal(m5StackChanPlatformManifest.config.touchActiveIntervalMs, 8)
    assert.equal(m5StackChanPlatformManifest.defines.ft6206.hz, 400000)
    assert.deepEqual(m5StackChanPlatformManifest.defines.camera, {
      xclk: -1,
      xclk_freq_hz: 20000000,
      scl: -1,
      sda: -1,
      i2c_port: 1,
    })
    assert.equal(m5StackChanPlatformManifest.modules['embedded:sensor/Touch/FT6x06'], './host/ft6206_async_m5stackchan')
    assert.match(
      m5StackChanProviderSource,
      /internal:\s*{\s*io:\s*I2C,\s*data:\s*12,\s*clock:\s*11,\s*port:\s*1,/s,
      'M5StackChan CoreS3 internal I2C should use port 1 so camera SCCB can share the bus',
    )
    assert.match(m5StackChanProviderSource, /hz:\s*400_000/, 'M5StackChan CoreS3 Touch provider should use 400kHz I2C')
    assert.doesNotMatch(
      m5StackChanProviderSource,
      /interrupt:\s*{/,
      'CoreS3 touch should poll instead of waiting on GPIO21 edge interrupts',
    )
    assert.match(
      m5StackChanTouchSource,
      /writeUint8\(REG_INT_MODE,\s*0x00/,
      'CoreS3 touch controller should be configured for polling mode',
    )
    assert.equal(m5StackChanPlatformManifest.config.driver.type, 'm5stackchan')
    assert.match(coreS3AudioOutSource, /globalThis\.amp\.sampleRate = this\.sampleRate/)
    assert.doesNotMatch(
      coreS3AudioOutSource,
      /globalThis\.amp\.volume\s*=/,
      'AudioOut should not force the amplifier back to a loud volume',
    )
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

  test('provides a M5StackChan CoreS3 smoke MOD and target-specific app config', () => {
    const smokeManifest = JSON.parse(readFileSync('mods/examples/m5stackchan_smoke/manifest.json', 'utf8'))
    const smokeSource = readFileSync('mods/examples/m5stackchan_smoke/mod.js', 'utf8')
    const smokeDocs = readFileSync('docs/m5stackchan-cores3-smoke.md', 'utf8')

    assert.deepEqual(m5StackChanStackchanManifest.include, ['./manifest.json'])
    assert.equal(m5StackChanStackchanManifest.config.enablePowerButton, false)
    assert.equal(m5StackChanPlatformManifest.config.driver.type, 'm5stackchan')
    assert.equal(m5StackChanPlatformManifest.config.driver.serial.transmit, 6)
    assert.equal(m5StackChanPlatformManifest.config.driver.serial.receive, 7)

    assert.deepEqual(smokeManifest.include, ['$(MODDABLE)/examples/manifest_mod.json'])
    assert.deepEqual(smokeManifest.modules, { '*': ['./mod'] })
    assert.equal(smokeManifest.config, undefined)

    for (const api of ['lightOn', 'lightBlink', 'lightRainbow', 'lightOff']) {
      assert.match(
        smokeSource,
        new RegExp(`robot\\.lighting\\.${api}\\b`),
        `smoke MOD should exercise robot.lighting.${api}`,
      )
    }
    for (const api of ['setTorque', 'setPose']) {
      assert.match(
        smokeSource,
        new RegExp(`robot\\.motion\\.${api}\\b`),
        `smoke MOD should exercise robot.motion.${api}`,
      )
    }
    assert.match(smokeSource, /M5StackChan CoreS3 smoke/)
    const documentedScripts = npmRunScripts(smokeDocs)
    assert.ok(documentedScripts.includes('build:m5stackchan_cores3'))
    assert.ok(documentedScripts.includes('flash:m5stackchan_cores3'))
    assert.ok(documentedScripts.includes('mod:m5stackchan_cores3'))
    for (const script of documentedScripts) {
      assert.ok(packageJson.scripts[script], `smoke docs reference missing npm script: ${script}`)
    }
    assert.match(packageJson.scripts['build:m5stackchan_cores3'], /firmware\.mjs build m5stackchan_cores3/)
    assert.match(packageJson.scripts['flash:m5stackchan_cores3'], /firmware\.mjs flash m5stackchan_cores3/)
    assert.match(packageJson.scripts['mod:m5stackchan_cores3'], /firmware\.mjs mod m5stackchan_cores3/)
    assert.match(smokeDocs, /mods\/examples\/m5stackchan_smoke\/manifest\.json/)
  })

  test('defines the stackchan_rt CoreS3 subplatform with Dynamixel bus pins', () => {
    // stackchan_rt is a CoreS3-based subplatform whose distinguishing feature is the
    // Dynamixel driver on TX=7/RX=6 (the RT servo bus), not the default SCServo bus.
    assert.deepEqual(stackchanRtPlatformManifest.include, [
      '$(BUILD)/devices/esp32/targets/m5stack_cores3/manifest.json',
    ])
    assert.equal(stackchanRtPlatformManifest.build.SUBPLATFORM, 'stackchan_rt')
    // A SUBPLATFORM build resolves $(SUBPLATFORMDIRECTORY)/host/provider, so the subplatform
    // must ship its own device provider. Reuse the stock CoreS3 touch/display/IMU wiring.
    const stackchanRtProviderSource = readFileSync('host/platforms/stackchan_rt/host/provider.js', 'utf8')
    assert.match(stackchanRtProviderSource, /from 'M5StackCoreS3Touch'/)
    assert.match(stackchanRtProviderSource, /export default device/)
    // The camera SCCB reuses the internal I2C bus (defines.camera sda/scl=-1, i2c_port=1). For
    // esp32-camera to find an already-initialized bus handle, the internal bus must be pinned to
    // port 1 — otherwise SCCB_Use_Port(1) fails and camera init fails. Mirrors M5StackChan CoreS3.
    assert.match(
      stackchanRtProviderSource,
      /internal:\s*\{[^}]*data:\s*12,[^}]*clock:\s*11,[^}]*port:\s*1\b/s,
      'stackchan_rt internal I2C should use port 1 so the camera SCCB can share the bus',
    )
    assert.deepEqual(stackchanRtPlatformManifest.defines.camera, {
      xclk: -1,
      xclk_freq_hz: 20000000,
      scl: -1,
      sda: -1,
      i2c_port: 1,
    })
    assert.equal(stackchanRtPlatformManifest.config.driver.type, 'dynamixel')
    assert.deepEqual(stackchanRtPlatformManifest.config.driver.serial, {
      transmit: 7,
      receive: 6,
      port: 1,
      baud: 1000000,
    })
    // The Dynamixel protocol prefers driver.serial, but keep the top-level serial aligned too.
    assert.deepEqual(stackchanRtPlatformManifest.config.serial, {
      transmit: 7,
      receive: 6,
      port: 1,
      baud: 1000000,
    })
    assert.deepEqual(stackchanRtAppManifest.include, ['./manifest.json'])

    assert.match(packageJson.scripts['build:stackchan_rt'], /firmware\.mjs build stackchan_rt/)
    assert.match(packageJson.scripts['deploy:stackchan_rt'], /firmware\.mjs deploy stackchan_rt/)
    assert.match(packageJson.scripts['mod:stackchan_rt'], /firmware\.mjs mod stackchan_rt/)
  })

  test('defines the Takao Core2 SG90 subplatform with PWM servo pins', () => {
    assert.deepEqual(takaoPlatformManifest.include, ['$(BUILD)/devices/esp32/targets/m5stack_core2/manifest.json'])
    assert.equal(takaoPlatformManifest.build.SUBPLATFORM, 'takao_core2_sg90')
    assert.match(takaoProviderSource, /data:\s*32/)
    assert.match(takaoProviderSource, /clock:\s*33/)
    assert.match(takaoProviderSource, /displayDC:\s*15/)
    assert.match(takaoProviderSource, /displaySelect:\s*5/)
    assert.deepEqual(takaoPlatformManifest.config.driver, {
      type: 'pwm',
      pwmPan: 19,
      pwmTilt: 27,
    })
    assert.deepEqual(takaoPlatformManifest.config.serial, {
      transmit: 14,
      receive: 13,
    })
    assert.equal(takaoPlatformManifest.config.tts.sampleRate, 24000)
    assert.deepEqual(takaoAppManifest, {
      include: ['./manifest.json'],
      config: {
        enablePowerButton: false,
      },
    })

    assert.match(packageJson.scripts['build:takao_core2_sg90'], /firmware\.mjs build takao_core2_sg90/)
    assert.match(packageJson.scripts['deploy:takao_core2_sg90'], /firmware\.mjs deploy takao_core2_sg90/)
    assert.match(packageJson.scripts['flash:takao_core2_sg90'], /firmware\.mjs flash takao_core2_sg90/)
    assert.match(packageJson.scripts['debug:takao_core2_sg90'], /firmware\.mjs debug takao_core2_sg90/)
    assert.match(packageJson.scripts['mod:takao_core2_sg90'], /firmware\.mjs mod takao_core2_sg90/)
  })
})
