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
    expect(result.current.values['mcp.token']).toBe('old-token')

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
    const send = vi.fn().mockRejectedValueOnce(new Error('connection lost')).mockResolvedValueOnce(undefined)
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
