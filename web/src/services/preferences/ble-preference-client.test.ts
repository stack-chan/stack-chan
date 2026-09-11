import { afterEach, describe, expect, it, vi } from 'vitest'

import { SETTING_KEYS, SETTINGS_SCHEMA } from '../../../../firmware/contracts/settings-schema.js'

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
    const { client, device, tx, onValue, notify } = connectionFixture()

    await client.connect()
    await client.connect()

    expect(device.gatt.connect).toHaveBeenCalledTimes(2)
    expect(device.listeners.get('gattserverdisconnected')?.size).toBe(1)
    expect(tx.listeners.get('characteristicvaluechanged')?.size).toBe(1)

    expect(onValue).toHaveBeenCalledTimes(SETTING_KEYS.length * 2)
    onValue.mockClear()
    notify({ prop: 'wifi.ssid', value: 'stackchan' })
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
  const snapshot = () => {
    notify({ kind: 'hello', protocol: 2 })
    for (const prop of SETTING_KEYS)
      notify({ prop, value: SETTINGS_SCHEMA[prop].secret ? '' : (SETTINGS_SCHEMA[prop].defaultValue ?? '') })
    notify({ kind: 'ready' })
  }
  tx.startNotifications.mockImplementation(async () => snapshot())
  return { client, device, rx, tx, notify, onValue, snapshot }
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
  notify({ kind: 'saved', requestId: 99, applications: ['restart'], applyFailed: false })
  await Promise.resolve()
  expect(settled).toBe(false)
  notify({ kind: 'saved', requestId: 1, applications: ['live'], applyFailed: false })
  expect(await saving).toEqual({ applications: ['live'], applyFailed: false })
  await client.disconnect()
})

it('decodes UTF-8 characters split at every byte without exposing fragmented values', async () => {
  const { client, notify, onValue } = connectionFixture()
  await client.connect()
  onValue.mockClear()
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

it.each([
  { applications: ['live'] },
  { applications: ['unknown'], applyFailed: false },
  { applications: [], applyFailed: 'false' },
])('rejects an incomplete or invalid save receipt: %j', async (receipt) => {
  const { client, notify } = connectionFixture()
  await client.connect()
  const saving = client.send({ _batch: { 'tts.volume': '0.2' } })
  notify({ kind: 'saved', requestId: 1, ...receipt })
  await expect(saving).rejects.toMatchObject({ code: 'invalid-notification' })
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

it('rejects firmware without a complete settings snapshot before any write', async () => {
  vi.useFakeTimers()
  const { client, tx, rx, onValue } = connectionFixture()
  tx.startNotifications.mockImplementation(async () => {})
  const rejected = expect(client.connect()).rejects.toMatchObject({ code: 'settings-not-ready' })
  await vi.advanceTimersByTimeAsync(5000)
  await rejected
  expect(client.isConnected()).toBe(false)
  await expect(client.send({ _batch: { 'tts.volume': '0.2' } })).rejects.toMatchObject({ code: 'not-connected' })
  expect(rx.writeValue).not.toHaveBeenCalled()
  expect(onValue).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(0)
})

it('holds initial values until every managed key and the ready marker arrive', async () => {
  const { client, tx, notify, onValue, rx } = connectionFixture()
  tx.startNotifications.mockImplementation(async () => {})
  const connecting = client.connect()
  await vi.waitFor(() => expect(tx.startNotifications).toHaveBeenCalledOnce())
  notify({ kind: 'hello', protocol: 2 })
  for (const prop of SETTING_KEYS) notify({ prop, value: '' })
  expect(client.isConnected()).toBe(false)
  expect(onValue).not.toHaveBeenCalled()
  await expect(client.send({ _batch: { 'tts.volume': '0.2' } })).rejects.toMatchObject({ code: 'not-connected' })
  expect(rx.writeValue).not.toHaveBeenCalled()
  notify({ kind: 'ready' })
  await connecting
  expect(client.isConnected()).toBe(true)
  expect(onValue).toHaveBeenCalledTimes(SETTING_KEYS.length)
  await client.disconnect()
})

it.each([
  [{ kind: 'hello', protocol: 1 }],
  [{ kind: 'hello', protocol: 2 }, { prop: 'tts.volume', value: 0.5 }, { kind: 'ready' }],
  [
    { kind: 'hello', protocol: 2 },
    { kind: 'error', code: 'IO', message: 'private storage error' },
  ],
])('rejects an incompatible or incomplete snapshot without exposing partial settings: %j', async (...frames) => {
  const { client, tx, notify, onValue } = connectionFixture()
  tx.startNotifications.mockImplementation(async () => {
    for (const frame of frames) notify(frame)
  })
  await expect(client.connect()).rejects.toMatchObject({ code: 'settings-not-ready' })
  expect(client.isConnected()).toBe(false)
  expect(onValue).not.toHaveBeenCalled()
})

it('cancels a pending snapshot on disconnect and ignores its late frames', async () => {
  vi.useFakeTimers()
  const { client, tx, notify, onValue, snapshot } = connectionFixture()
  tx.startNotifications.mockImplementation(async () => {})
  const rejected = expect(client.connect()).rejects.toMatchObject({ code: 'disconnected' })
  await vi.advanceTimersByTimeAsync(1)
  notify({ kind: 'hello', protocol: 2 })
  notify({ prop: 'wifi.ssid', value: 'stale' })
  await client.disconnect()
  await rejected
  snapshot()
  expect(onValue).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(0)
  tx.startNotifications.mockImplementation(async () => snapshot())
  await client.connect()
  expect(client.isConnected()).toBe(true)
  await client.disconnect()
  expect(vi.getTimerCount()).toBe(0)
})

it('waits for a newline even when a notification contains a complete JSON object', async () => {
  const { client, tx, onValue } = connectionFixture()
  await client.connect()
  onValue.mockClear()
  const bytes = new TextEncoder().encode(JSON.stringify({ prop: 'wifi.ssid', value: 'framed' }))
  tx.dispatch('characteristicvaluechanged', { target: { value: bytes } })
  expect(onValue).not.toHaveBeenCalled()
  tx.dispatch('characteristicvaluechanged', { target: { value: new Uint8Array([10]) } })
  expect(onValue).toHaveBeenCalledExactlyOnceWith({ prop: 'wifi.ssid', value: 'framed' })
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
  notify({ kind: 'saved', requestId: 2, applications: ['live'], applyFailed: false })
  expect((await saving).applications).toEqual(['live'])
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
  notify({ kind: 'saved', requestId: 2, applications: ['live'], applyFailed: false })
  expect((await newSave).applications).toEqual(['live'])
  await client.disconnect()
})
