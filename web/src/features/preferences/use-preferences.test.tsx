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
})
