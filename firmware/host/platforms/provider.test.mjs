import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { test } from 'node:test'
import vm from 'node:vm'

const sdk = process.env.MODDABLE
if (!sdk) throw new Error('Set MODDABLE to the SDK used for the provider build')

async function loadDevice(board) {
  const context = vm.createContext({ trace() {}, power: { brightness: 100 } })
  const modules = new Map()
  const folder = path.resolve('host/platforms', board)
  const manifest = JSON.parse(await readFile(path.join(folder, 'manifest.json'), 'utf8'))
  const base = manifest.modules['sdk-board-provider'].replace('$(BUILD)', path.join(sdk, 'build'))
  async function sourceModule(key, filename) {
    if (modules.has(key)) return modules.get(key)
    const module = new vm.SourceTextModule(await readFile(filename, 'utf8'), { context, identifier: key })
    modules.set(key, module)
    return module
  }
  const builtin = await sourceModule('embedded:provider/builtin', path.join(folder, 'host/provider.js'))
  const link = async (specifier) => {
    if (modules.has(specifier)) return modules.get(specifier)
    if (specifier === 'sdk-board-provider') return sourceModule(specifier, `${base}.js`)
    class Peripheral {
      static Input = 0
      constructor(options) {
        this.options = options
      }
      configure(options) {
        this.configuration = options
      }
    }
    const module = new vm.SyntheticModule(
      ['default'],
      function () {
        this.setExport('default', Peripheral)
      },
      { context },
    )
    modules.set(specifier, module)
    return module
  }
  await builtin.link(link)
  await builtin.evaluate()
  for (const io of ['analog', 'digital', 'i2c', 'pulsecount', 'pulsewidth', 'pwm', 'serial', 'spi']) {
    const module = await sourceModule(`config/${io}`, path.join(sdk, 'modules/io', io, 'config.js'))
    await module.link(link)
    await module.evaluate()
  }
  const lockdown = await sourceModule('lockdown/device', path.join(sdk, 'modules/io/system/lockdowndevice.js'))
  await lockdown.link(link)
  await lockdown.evaluate()
  context.cameraPort = manifest.defines?.camera?.i2c_port
  return context
}

for (const board of ['m5stackchan_cores3', 'stackchan_rt', 'takao_core2_sg90']) {
  test(`${board}: SDK IO configuration resolves required buses and preserves peripherals`, async () => {
    const context = await loadDevice(board)
    const device = context.device
    assert.equal(device.i2c.default.io, device.io.I2C)
    assert.equal(device.i2c.internal.io, device.io.I2C)
    assert.equal(device.serial.default.io, device.io.Serial)
    assert.equal(device.rtc.clock.io, device.io.SMBus)
    for (const io of [
      'Analog',
      'Digital',
      'DigitalBank',
      'I2C',
      'SMBus',
      'PulseCount',
      'PulseWidth',
      'PWM',
      'Serial',
      'SPI',
    ]) {
      assert.equal(typeof device.io[io], 'function')
    }
    assert.equal(device.analog.default.io, device.io.Analog)
    assert.equal(device.spi.default.io, device.io.SPI)
    for (const [lowercase, legacy] of [
      ['analog', 'Analog'],
      ['i2c', 'I2C'],
      ['serial', 'Serial'],
      ['spi', 'SPI'],
    ]) {
      assert.equal(device[legacy], device[lowercase])
    }
    const legacyRTC = new device.peripheral.RTC({})
    assert.equal(legacyRTC.options.clock, device.rtc.clock)
    assert.equal(Object.isFrozen(device), true)
    const imu = new device.sensor.IMU({})
    assert.equal(imu.options.sensor.io, device.io.SMBus)
    const touch = new device.sensor.Touch({})
    assert.equal(touch.options.sensor.io, device.io.SMBus)
    assert.equal(touch.configuration.threshold, 20)
    if (board === 'takao_core2_sg90') {
      assert.equal(device.i2c.internal.data, 21)
      assert.equal(device.i2c.internal.clock, 22)
      const power = new device.peripheral.Power({})
      assert.equal(power.options.peripheral.io, device.io.SMBus)
      assert.equal(touch.options.interrupt.pin, 39)
    } else {
      assert.equal(device.i2c.internal.data, 12)
      assert.equal(device.i2c.internal.clock, 11)
      assert.equal(device.i2c.internal.port, context.cameraPort)
      assert.equal(device.rtc.clock.port, context.cameraPort)
      assert.equal(touch.options.sensor.port, context.cameraPort)
      assert.equal(imu.options.sensor.port, context.cameraPort)
      assert.equal(imu.options.sensor.address, 0x69)
    }
    if (board === 'm5stackchan_cores3') {
      assert.equal(touch.options.sensor.hz, 400_000)
      assert.equal(touch.configuration.active, false)
      assert.equal(touch.configuration.timeout, 10)
      const panel = new device.sensor.TouchPanel({ channels: 3, sensitivityLevel: 3 })
      assert.equal(panel.options.sensor.port, context.cameraPort)
      assert.equal(panel.options.sensor.io, device.io.SMBus)
      assert.equal(panel.options.channels, 3)
    }
    contextBacklight(device, context.power)
  })
}

function contextBacklight(device, power) {
  const backlight = new device.peripheral.Backlight()
  backlight.brightness = -1
  assert.equal(backlight.brightness, 0)
  assert.equal(power.brightness, 0)
  backlight.brightness = 0.5
  assert.equal(power.brightness, 50)
  backlight.brightness = 2
  assert.equal(backlight.brightness, 1)
  assert.equal(power.brightness, 100)
  backlight.close()
}
