import { useCallback, useEffect, useRef, useState } from 'react'

import {
  DEFAULT_PREFERENCES,
  isPreferenceKey,
  validPreferenceValue,
  type PreferenceKey,
  type PreferenceValues,
} from '@/features/preferences/preference-model'
import { type OperationState } from '@/features/operations/operation-state'
import { toAppError } from '@/lib/errors/app-error'
import {
  BlePreferenceClient,
  type PreferenceClient,
  type PreferenceValue,
} from '@/services/preferences/ble-preference-client'

type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'disconnecting'
type ClientFactory = (onValue: (value: PreferenceValue) => void) => PreferenceClient

export function usePreferences(
  clientFactory: ClientFactory = (onValue) => new BlePreferenceClient({ deviceName: 'STK', onValue })
) {
  const [connection, setConnection] = useState<ConnectionState>('disconnected')
  const [values, setValues] = useState<PreferenceValues>(DEFAULT_PREFERENCES)
  const [readOnly, setReadOnly] = useState<Set<PreferenceKey>>(() => new Set())
  const [operation, setOperation] = useState<OperationState>({ status: 'idle' })
  const valuesRef = useRef<PreferenceValues>(DEFAULT_PREFERENCES)
  const received = useRef<Partial<PreferenceValues>>({})
  const session = useRef(0)
  const sending = useRef(false)
  const connecting = useRef(false)
  const currentValues = useRef<Partial<PreferenceValues>>({})
  const dirty = useRef(new Set<PreferenceKey>())
  const readOnlyRef = useRef(new Set<PreferenceKey>())
  const valueHandler = useRef<(value: PreferenceValue) => void>(() => {})
  const client = useRef<PreferenceClient | undefined>(undefined)

  valueHandler.current = ({ prop, value, readOnly: isReadOnly = false }) => {
    if (!isPreferenceKey(prop)) return
    const normalized = String(value)
    currentValues.current[prop] = normalized
    received.current[prop] = normalized
    const nextReadOnly = new Set(readOnlyRef.current)
    if (isReadOnly) {
      nextReadOnly.add(prop)
      dirty.current.delete(prop)
    } else {
      nextReadOnly.delete(prop)
    }
    readOnlyRef.current = nextReadOnly
    setReadOnly(nextReadOnly)
    if (!dirty.current.has(prop)) {
      valuesRef.current = { ...valuesRef.current, [prop]: normalized }
      setValues(valuesRef.current)
    }
  }

  if (!client.current) client.current = clientFactory((value) => valueHandler.current(value))

  useEffect(() => {
    const activeClient = client.current
    if (!activeClient) return
    activeClient.onDisconnected = () => {
      setConnection('disconnected')
      setOperation({
        status: 'cancelled',
        message: '接続が切れました。保存されていない項目を確認してください。',
      })
      session.current += 1
      received.current = {}
      currentValues.current = {}
      readOnlyRef.current = new Set()
      setReadOnly(new Set())
    }
    return () => {
      activeClient.onDisconnected = undefined
      if (activeClient.isConnected()) activeClient.disconnect().catch(() => {})
    }
  }, [])

  const connect = useCallback(async () => {
    const activeClient = client.current
    if (!activeClient) return
    if (connecting.current || sending.current) return { ok: false as const, code: 'busy' }
    if (activeClient.isConnected()) return { ok: true as const, status: 'connected' }
    connecting.current = true
    session.current += 1
    currentValues.current = {}
    received.current = {}
    dirty.current.clear()
    readOnlyRef.current = new Set()
    setReadOnly(new Set())
    valuesRef.current = { ...DEFAULT_PREFERENCES }
    setValues(valuesRef.current)
    setConnection('connecting')
    setOperation({ status: 'pending', message: 'BLEデバイスを検索しています' })
    try {
      await activeClient.connect()
      setConnection('connected')
      setOperation({ status: 'success', result: undefined, message: 'ｽﾀｯｸﾁｬﾝへ接続しました' })
      return { ok: true as const, status: 'connected' }
    } catch (error) {
      setConnection('disconnected')
      setOperation({ status: 'error', error: toAppError(error, 'ble-connect') })
      return { ok: false as const, code: 'connection_failed' }
    } finally {
      connecting.current = false
    }
  }, [])

  const disconnect = useCallback(async () => {
    const activeClient = client.current
    if (!activeClient) return
    setConnection('disconnecting')
    try {
      await activeClient.disconnect()
      session.current += 1
      currentValues.current = {}
      received.current = {}
      readOnlyRef.current = new Set()
      setReadOnly(new Set())
      setConnection('disconnected')
      setOperation({ status: 'cancelled', message: 'BLE接続を切断しました' })
      return { ok: true as const, status: 'disconnected' }
    } catch (error) {
      setConnection(activeClient.isConnected() ? 'connected' : 'disconnected')
      setOperation({ status: 'error', error: toAppError(error, 'ble-disconnect') })
      return { ok: false as const, code: 'disconnect_failed' }
    }
  }, [])

  const update = useCallback((key: PreferenceKey, value: string) => {
    if (readOnlyRef.current.has(key)) return
    if (currentValues.current[key] === value) dirty.current.delete(key)
    else dirty.current.add(key)
    valuesRef.current = { ...valuesRef.current, [key]: value }
    setValues(valuesRef.current)
  }, [])

  const savePayload = useCallback(async (payload: Partial<PreferenceValues>, successMessage: string) => {
    const activeClient = client.current
    if (!activeClient?.isConnected()) return { ok: false as const, code: 'not_connected' }
    if (sending.current) return { ok: false as const, code: 'busy' }
    const entries = Object.entries(payload).filter(([key]) => !readOnlyRef.current.has(key as PreferenceKey))
    if (entries.length === 0) {
      setOperation({ status: 'cancelled', message: '変更する項目がありません。' })
      return { ok: true as const, status: 'unchanged', sentKeys: [] }
    }
    if (entries.some(([key, value]) => !validPreferenceValue(key as PreferenceKey, value!))) {
      setOperation({ status: 'error', error: toAppError('設定値を確認してください。', 'invalid_input') })
      return { ok: false as const, code: 'invalid_input' }
    }
    const batch = Object.fromEntries(entries)
    sending.current = true
    const connectionSession = session.current
    setOperation({ status: 'pending', message: '設定を保存しています' })
    try {
      await activeClient.send({ _batch: batch })
      if (session.current !== connectionSession || !activeClient.isConnected())
        return { ok: false as const, code: 'disconnected' }
      for (const [key, value] of entries) {
        const preferenceKey = key as PreferenceKey
        currentValues.current[preferenceKey] = value
        if (valuesRef.current[preferenceKey] === value) dirty.current.delete(preferenceKey)
      }
      setOperation({ status: 'success', result: undefined, message: successMessage })
      return {
        ok: true as const,
        status: 'sent',
        sentKeys: entries.map(([key]) => key),
        confirmedKeys: entries
          .filter(([key, value]) => received.current[key as PreferenceKey] === value)
          .map(([key]) => key),
      }
    } catch (error) {
      setOperation({ status: 'error', error: toAppError(error, 'preference-save') })
      return { ok: false as const, code: 'send_failed' }
    } finally {
      sending.current = false
    }
  }, [])

  const save = useCallback(() => {
    const payload: Partial<PreferenceValues> = {}
    for (const key of dirty.current) {
      if (!readOnlyRef.current.has(key) && currentValues.current[key] !== valuesRef.current[key]) {
        payload[key] = valuesRef.current[key]
      }
    }
    return savePayload(payload, '設定を送信しました。')
  }, [savePayload])

  const clearWifi = useCallback(async () => {
    if (!client.current?.isConnected()) return { ok: false as const, code: 'not_connected' }
    if (sending.current) return { ok: false as const, code: 'busy' }
    if (readOnlyRef.current.has('wifi.ssid') || readOnlyRef.current.has('wifi.password')) {
      setOperation({ status: 'error', error: toAppError('本体側で固定されている項目は変更できません。', 'read_only') })
      return { ok: false as const, code: 'read_only' }
    }
    dirty.current.add('wifi.ssid')
    dirty.current.add('wifi.password')
    valuesRef.current = { ...valuesRef.current, 'wifi.ssid': '', 'wifi.password': '' }
    setValues(valuesRef.current)
    return savePayload(
      { 'wifi.ssid': '', 'wifi.password': '' },
      'Wi-Fi設定を消去しました。再起動後はオフラインになります。'
    )
  }, [savePayload])

  return {
    getState: () => ({
      session: session.current,
      connected: client.current?.isConnected() ?? false,
      values: { ...valuesRef.current },
      received: { ...received.current },
      dirty: [...dirty.current],
      readOnly: [...readOnlyRef.current],
      sending: sending.current,
    }),
    connection,
    connected: connection === 'connected',
    busy: connection === 'connecting' || connection === 'disconnecting' || operation.status === 'pending',
    values,
    readOnly,
    operation,
    connect,
    disconnect,
    update,
    save,
    clearWifi,
  }
}
