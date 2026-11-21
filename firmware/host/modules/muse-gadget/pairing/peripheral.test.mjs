import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

test('radio factory is inert until called, advertising explicit, read opaque and close releases BLE', async () => {
  let instance,
    constructions = 0,
    advertised = 0,
    closed = 0,
    mtu,
    options
  class BLE {
    constructor() {
      ++constructions
      instance = this
    }
    startAdvertising(value) {
      ++advertised
      options = value
    }
    stopAdvertising() {}
    close() {
      ++closed
    }
  }
  const context = vm.createContext({ Uint8Array, Promise, Error })
  const fixtures = {
    './device-wifi-scan.js': {
      startDeviceWiFiScan: () => {
        throw new Error('unexpected scan')
      },
    },
    './notify.js': { default: () => true },
    bleserver: { default: BLE },
    btutils: { uuid: (strings) => strings[0] },
    'text/encoder': { default: TextEncoder },
    'text/decoder': { default: TextDecoder },
    timer: {
      default: {
        repeat() {
          return 1
        },
        clear() {},
      },
    },
    './session.js': {
      createPairingSession: () => ({
        setMTU(v) {
          mtu = v
        },
        readStatus() {
          return 'encrypted_status'
        },
        close() {
          throw new Error('native_close')
        },
        confirmPhysical() {},
      }),
    },
  }
  const mod = new vm.SourceTextModule(await readFile(new URL('./peripheral.js', import.meta.url), 'utf8'), { context })
  await mod.link(
    (name) =>
      new vm.SyntheticModule(
        Object.keys(fixtures[name]),
        function () {
          for (const [k, v] of Object.entries(fixtures[name])) this.setExport(k, v)
        },
        { context },
      ),
  )
  await mod.evaluate()
  assert.throws(() => mod.namespace.createPairingPeripheral({ native: {}, name: 'Test' }))
  assert.equal(constructions, 0)
  const api = mod.namespace.createPairingPeripheral({ native: {}, name: 'Test', setupComplete: false })
  assert.equal(constructions, 1)
  assert.equal(advertised, 0)
  instance.onReady()
  assert.equal(advertised, 0)
  api.advertise()
  assert.equal(advertised, 1)
  assert.equal(options.advertisingData.manufacturerSpecific.identifier, 65535)
  instance.onMTUExchanged(247)
  assert.equal(mtu, 247)
  assert.equal(new TextDecoder().decode(instance.onCharacteristicRead()), 'encrypted_status')
  assert.throws(() => api.close())
  assert.equal(closed, 1)
})
