import { afterEach, describe, expect, it, vi } from 'vitest'

import { BlePreferenceClient } from '@/services/preferences/ble-preference-client'

type Listener = (event: never) => void

class FakeEventTarget {
  readonly listeners = new Map<string, Set<Listener>>()

  addEventListener(name: string, listener: Listener) {
    const listeners = this.listeners.get(name) ?? new Set()
    listeners.add(listener)
    this.listeners.set(name, listeners)
  }

  removeEventListener(name: string, listener: Listener) {
    this.listeners.get(name)?.delete(listener)
  }

  dispatch(name: string, event: unknown) {
    for (const listener of this.listeners.get(name) ?? []) listener(event as never)
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('BlePreferenceClient', () => {
  it('reuses devices and characteristics without accumulating event listeners', async () => {
    const tx = Object.assign(new FakeEventTarget(), {
      startNotifications: vi.fn(async () => {}),
      writeValue: vi.fn(async () => {}),
    })
    const rx = Object.assign(new FakeEventTarget(), {
      startNotifications: vi.fn(async () => {}),
      writeValue: vi.fn(async () => {}),
    })
    const device = Object.assign(new FakeEventTarget(), {
      gatt: {
        connected: false,
        connect: vi.fn(async () => {
          device.gatt.connected = true
          return {
            getPrimaryService: async () => ({
              getCharacteristic: async (uuid: string) => (uuid.endsWith('0002-b5a3-f393-e0a9-e50e24dcca9e') ? rx : tx),
            }),
          }
        }),
        disconnect: vi.fn(() => {
          device.gatt.connected = false
        }),
      },
    })
    const requestDevice = vi.fn(async () => device)
    vi.stubGlobal('navigator', { bluetooth: { requestDevice } })
    const onValue = vi.fn()
    const client = new BlePreferenceClient({ deviceName: 'STK', onValue })

    await client.connect()
    await client.connect()

    expect(requestDevice).toHaveBeenCalledTimes(2)
    expect(device.listeners.get('gattserverdisconnected')?.size).toBe(1)
    expect(tx.listeners.get('characteristicvaluechanged')?.size).toBe(1)

    tx.dispatch('characteristicvaluechanged', {
      target: { value: new TextEncoder().encode(JSON.stringify({ prop: 'wifi.ssid', value: 'stackchan' })) },
    })
    expect(onValue).toHaveBeenCalledOnce()

    await client.disconnect()
    expect(device.listeners.get('gattserverdisconnected')?.size).toBe(0)
    expect(tx.listeners.get('characteristicvaluechanged')?.size).toBe(0)
  })
})
