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
  vi.useRealTimers()
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

function connectionFixture() {
  const tx = Object.assign(new FakeEventTarget(), {
    startNotifications: vi.fn(async () => {}),
    writeValue: vi.fn(async (_value: BufferSource) => {}),
  })
  const rx = Object.assign(new FakeEventTarget(), {
    startNotifications: vi.fn(async () => {}),
    writeValue: vi.fn(async (_value: BufferSource) => {}),
  })
  const device = Object.assign(new FakeEventTarget(), {
    gatt: {
      connected: false,
      connect: vi.fn(async () => {
        device.gatt.connected = true
        return {
          getPrimaryService: async () => ({
            getCharacteristic: async (uuid: string) => (uuid.includes('0002-') ? rx : tx),
          }),
        }
      }),
      disconnect: vi.fn(() => {
        device.gatt.connected = false
      }),
    },
  })
  vi.stubGlobal('navigator', { bluetooth: { requestDevice: async () => device } })
  const onValue = vi.fn()
  const client = new BlePreferenceClient({ deviceName: 'STK', onValue })
  const notify = (message: object, chunkSize = 20) => {
    const bytes = new TextEncoder().encode(JSON.stringify(message) + '\n')
    for (let index = 0; index < bytes.length; index += chunkSize)
      tx.dispatch('characteristicvaluechanged', { target: { value: bytes.slice(index, index + chunkSize) } })
  }
  tx.startNotifications.mockImplementation(async () => notify({ kind: 'hello', protocol: 2 }))
  return { client, device, rx, tx, notify, onValue }
}

it('waits for a matching device save acknowledgement and returns its application timing', async () => {
  const { client, notify, rx } = connectionFixture()
  await client.connect()
  let settled = false
  const saving = client.send({ _batch: { 'tts.volume': '0.25' } }).then((receipt) => {
    settled = true
    return receipt
  })
  await Promise.resolve()
  expect(rx.writeValue).toHaveBeenCalledOnce()
  expect(settled).toBe(false)
  notify({ kind: 'saved', requestId: 99, applications: ['restart'] })
  await Promise.resolve()
  expect(settled).toBe(false)
  notify({ kind: 'saved', requestId: 1, applications: ['live'] })
  expect(await saving).toEqual({ confirmed: true, applications: ['live'], applyFailed: false })
  await client.disconnect()
})

it('decodes UTF-8 characters split at every byte without exposing fragmented values', async () => {
  const { client, notify, onValue } = connectionFixture()
  await client.connect()
  notify({ prop: 'wifi.ssid', value: 'ｽﾀｯｸﾁｬﾝ🤖' }, 1)
  expect(onValue).toHaveBeenCalledExactlyOnceWith({ prop: 'wifi.ssid', value: 'ｽﾀｯｸﾁｬﾝ🤖' })
  await client.disconnect()
})

it('rejects storage errors without copying arbitrary device error text', async () => {
  const { client, notify } = connectionFixture()
  await client.connect()
  const saving = client.send({ _batch: { 'tts.token': 'new-token' } })
  notify({ kind: 'error', requestId: 1, code: 'IO', message: 'secret storage exception' })
  await expect(saving).rejects.toMatchObject({ code: 'IO', message: '本体が設定を保存できませんでした' })
  await client.disconnect()
})

it('rejects a concurrent save and a disconnected pending acknowledgement', async () => {
  const { client } = connectionFixture()
  await client.connect()
  const saving = client.send({ _batch: { 'tts.volume': '0.2' } })
  const rejected = expect(saving).rejects.toBeInstanceOf(Error)
  await expect(client.send({ _batch: { 'tts.volume': '0.3' } })).rejects.toMatchObject({ code: 'busy' })
  await client.disconnect()
  await rejected
})

it('times out a missing storage acknowledgement instead of claiming success', async () => {
  vi.useFakeTimers()
  const { client } = connectionFixture()
  await client.connect()
  const saving = client.send({ _batch: { 'tts.volume': '0.2' } })
  const rejected = expect(saving).rejects.toMatchObject({ code: 'save-timeout' })
  await vi.advanceTimersByTimeAsync(10000)
  await rejected
  await client.disconnect()
  expect(vi.getTimerCount()).toBe(0)
})

it('reports old firmware sends as unconfirmed', async () => {
  vi.useFakeTimers()
  const { client, tx } = connectionFixture()
  tx.startNotifications.mockImplementation(async () => {})
  await client.connect()
  const saving = client.send({ _batch: { 'tts.volume': '0.2' } })
  await vi.advanceTimersByTimeAsync(1500)
  expect(await saving).toEqual({ confirmed: false })
  await client.disconnect()
})

it('bounds messages before any BLE write and can recover for the next request', async () => {
  const { client, rx, notify } = connectionFixture()
  await client.connect()
  await expect(client.send({ _batch: { 'ai.context': 'x'.repeat(40000) } })).rejects.toMatchObject({
    code: 'settings-too-large',
  })
  expect(rx.writeValue).not.toHaveBeenCalled()
  const saving = client.send({ _batch: { 'tts.volume': '0.2' } })
  notify({ kind: 'saved', requestId: 2, applications: ['live'] })
  expect((await saving).confirmed).toBe(true)
  await client.disconnect()
})

it('does not let a late write from an old connection reject a new save', async () => {
  const { client, rx, notify } = connectionFixture()
  await client.connect()
  let completeOldWrite!: () => void
  rx.writeValue.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        completeOldWrite = resolve
      })
  )
  const oldSave = client.send({ _batch: { 'tts.volume': '0.2' } })
  const rejected = expect(oldSave).rejects.toMatchObject({ code: 'disconnected' })
  await client.disconnect()
  await client.connect()
  const newSave = client.send({ _batch: { 'tts.volume': '0.3' } })
  completeOldWrite()
  await rejected
  notify({ kind: 'saved', requestId: 2, applications: ['live'] })
  expect((await newSave).confirmed).toBe(true)
  await client.disconnect()
})
