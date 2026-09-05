import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { usePreferences } from '@/features/preferences/use-preferences'
import { type PreferenceClient, type PreferenceValue } from '@/services/preferences/ble-preference-client'

describe('usePreferences', () => {
  it('keeps remote values, dirty fields, and batched save in application state', async () => {
    let connected = false
    let notify: (value: PreferenceValue) => void = () => {}
    const send = vi.fn(async () => {})
    const client: PreferenceClient = {
      connect: async () => {
        connected = true
      },
      disconnect: async () => {
        connected = false
      },
      isConnected: () => connected,
      send,
    }
    const { result } = renderHook(() =>
      usePreferences((onValue) => {
        notify = onValue
        return client
      })
    )

    await act(() => result.current.connect())
    expect(result.current.connected).toBe(true)
    act(() => notify({ prop: 'wifi.ssid', value: 'stackchan' }))
    expect(result.current.values['wifi.ssid']).toBe('stackchan')
    act(() => result.current.update('wifi.ssid', 'new-network'))
    act(() => notify({ prop: 'wifi.ssid', value: 'stale-remote' }))
    expect(result.current.values['wifi.ssid']).toBe('new-network')
    await act(() => result.current.save())
    expect(send).toHaveBeenCalledWith({ _batch: { 'wifi.ssid': 'new-network' } })
  })

  it('does not edit fields marked read-only by the device', () => {
    let notify: (value: PreferenceValue) => void = () => {}
    const client: PreferenceClient = {
      connect: async () => {},
      disconnect: async () => {},
      isConnected: () => true,
      send: async () => {},
    }
    const { result } = renderHook(() =>
      usePreferences((onValue) => {
        notify = onValue
        return client
      })
    )
    act(() => notify({ prop: 'driver.type', value: 'fixed', readOnly: true }))
    act(() => result.current.update('driver.type', 'changed'))
    expect(result.current.values['driver.type']).toBe('fixed')
  })

  it('loads and saves the MCP server token', async () => {
    let notify: (value: PreferenceValue) => void = () => {}
    const send = vi.fn(async () => {})
    const client: PreferenceClient = {
      connect: async () => {},
      disconnect: async () => {},
      isConnected: () => true,
      send,
    }
    const { result } = renderHook(() =>
      usePreferences((onValue) => {
        notify = onValue
        return client
      })
    )

    act(() => notify({ prop: 'mcp.token', value: 'old-token' }))
    expect(result.current.values['mcp.token']).toBe('')
    expect(result.current.configuredSecrets.has('mcp.token')).toBe(true)

    act(() => result.current.update('mcp.token', 'new-token'))
    await act(() => result.current.save())

    expect(send).toHaveBeenCalledWith({ _batch: { 'mcp.token': 'new-token' } })
  })

  it('does not save a field reverted to its current device value', async () => {
    let notify: (value: PreferenceValue) => void = () => {}
    const send = vi.fn(async () => {})
    const client: PreferenceClient = {
      connect: async () => {},
      disconnect: async () => {},
      isConnected: () => true,
      send,
    }
    const { result } = renderHook(() =>
      usePreferences((onValue) => {
        notify = onValue
        return client
      })
    )
    act(() => notify({ prop: 'wifi.ssid', value: 'stackchan' }))
    act(() => result.current.update('wifi.ssid', 'new-network'))
    act(() => result.current.update('wifi.ssid', 'stackchan'))

    await act(() => result.current.save())

    expect(send).not.toHaveBeenCalled()
    expect(result.current.operation).toMatchObject({ status: 'cancelled' })
  })

  it('keeps cleared Wi-Fi fields retryable when the immediate save fails', async () => {
    let notify: (value: PreferenceValue) => void = () => {}
    const send = vi.fn().mockRejectedValueOnce(new Error('connection lost')).mockResolvedValueOnce({ confirmed: true })
    const client: PreferenceClient = {
      connect: async () => {},
      disconnect: async () => {},
      isConnected: () => true,
      send,
    }
    const { result } = renderHook(() =>
      usePreferences((onValue) => {
        notify = onValue
        return client
      })
    )
    act(() => {
      notify({ prop: 'wifi.ssid', value: 'stackchan' })
      notify({ prop: 'wifi.password', value: 'secret' })
    })

    await act(() => result.current.clearWifi())
    expect(result.current.operation.status).toBe('error')

    await act(() => result.current.save())
    expect(send).toHaveBeenNthCalledWith(1, { _batch: { 'wifi.ssid': '', 'wifi.password': '' } })
    expect(send).toHaveBeenNthCalledWith(2, { _batch: { 'wifi.ssid': '', 'wifi.password': '' } })
    expect(result.current.operation.status).toBe('success')
  })

  it('contains disconnect failures during unmount cleanup', async () => {
    const disconnect = vi.fn(async () => {
      throw new Error('adapter already closed')
    })
    const client: PreferenceClient = {
      connect: async () => {},
      disconnect,
      isConnected: () => true,
      send: async () => {},
    }
    const { unmount } = renderHook(() => usePreferences(() => client))

    unmount()
    await Promise.resolve()

    expect(disconnect).toHaveBeenCalledOnce()
  })
})

function hookFixture(send = vi.fn(async () => ({ confirmed: true }))) {
  let notify: (value: PreferenceValue) => void = () => {}
  const client: PreferenceClient = {
    connect: async () => {},
    disconnect: async () => {},
    isConnected: () => true,
    send,
  }
  const hook = renderHook(() =>
    usePreferences((onValue) => {
      notify = onValue
      return client
    })
  )
  return { ...hook, send, notify: (value: PreferenceValue) => notify(value) }
}

it('validates the whole edit before sending a BLE request', async () => {
  const { result, send } = hookFixture()
  act(() => {
    result.current.update('wifi.ssid', 'new')
    result.current.update('tts.volume', '2')
  })
  await act(() => result.current.save())
  expect(send).not.toHaveBeenCalled()
  expect(result.current.operation.status).toBe('error')
})

it('keeps secrets redacted, preserves an untouched stored token, and permits explicit clearing', async () => {
  const { result, send, notify } = hookFixture()
  act(() => notify({ prop: 'tts.token', value: '', secret: true, configured: true }))
  act(() => result.current.update('tts.volume', '0.25'))
  await act(() => result.current.save())
  expect(send).toHaveBeenLastCalledWith({ _batch: { 'tts.volume': '0.25' } })
  act(() => result.current.clearSecret('tts.token'))
  await act(() => result.current.save())
  expect(send).toHaveBeenLastCalledWith({ _batch: { 'tts.token': '' } })
  expect(result.current.configuredSecrets.has('tts.token')).toBe(false)
  expect(result.current.values['tts.token']).toBe('')
})

it('clears a typed secret after confirmed persistence', async () => {
  const { result, notify } = hookFixture()
  act(() => notify({ prop: 'ai.token', value: '', configured: false, secret: true }))
  act(() => result.current.update('ai.token', 'private-input'))
  await act(() => result.current.save())
  expect(result.current.values['ai.token']).toBe('')
  expect(result.current.configuredSecrets.has('ai.token')).toBe(true)
  expect(result.current.operation.status).toBe('success')
})

it('preserves edits when a legacy server cannot confirm persistence', async () => {
  const { result, send } = hookFixture(vi.fn(async () => ({ confirmed: false })))
  act(() => result.current.update('tts.volume', '0.25'))
  await act(() => result.current.save())
  expect(result.current.operation.status).toBe('cancelled')
  await act(() => result.current.save())
  expect(send).toHaveBeenCalledTimes(2)
})

it('displays the effective device value after an optional setting reset', async () => {
  const { result, notify, send } = hookFixture()
  act(() => notify({ prop: 'tts.port', value: 8080 }))
  send.mockImplementationOnce(async () => {
    notify({ prop: 'tts.port', value: 50021 })
    return { confirmed: true }
  })
  act(() => result.current.update('tts.port', ''))
  await act(() => result.current.save())
  expect(result.current.values['tts.port']).toBe('50021')
})

it('can undo a pending secret deletion without writing it', async () => {
  const { result, notify, send } = hookFixture()
  act(() => notify({ prop: 'mcp.token', value: '', configured: true }))
  act(() => result.current.clearSecret('mcp.token'))
  expect(result.current.secretsToClear.has('mcp.token')).toBe(true)
  act(() => result.current.clearSecret('mcp.token'))
  expect(result.current.secretsToClear.has('mcp.token')).toBe(false)
  await act(() => result.current.save())
  expect(send).not.toHaveBeenCalled()
})

it('preserves a newer draft when the previous save finishes', async () => {
  const { result, send } = hookFixture()
  let finish!: (receipt: { confirmed: boolean }) => void
  send.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  act(() => result.current.update('tts.volume', '0.25'))
  let saving!: Promise<void>
  act(() => {
    saving = result.current.save()
  })
  act(() => result.current.update('tts.volume', '0.75'))
  await act(async () => {
    finish({ confirmed: true })
    await saving
  })
  expect(result.current.values['tts.volume']).toBe('0.75')
  await act(() => result.current.save())
  expect(send).toHaveBeenLastCalledWith({ _batch: { 'tts.volume': '0.75' } })
})
