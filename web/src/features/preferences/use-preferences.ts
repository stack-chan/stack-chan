import { useCallback, useEffect, useRef, useState } from 'react'

import {
  DEFAULT_PREFERENCES,
  SETTINGS_SCHEMA,
  validateSetting,
  isPreferenceKey,
  type PreferenceKey,
  type PreferenceValues,
} from '@/features/preferences/preference-model'
import { type OperationState } from '@/features/operations/operation-state'
import { AppError, toAppError } from '@/lib/errors/app-error'
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
  const [configuredSecrets, setConfiguredSecrets] = useState<Set<PreferenceKey>>(() => new Set())
  const [secretsToClear, setSecretsToClear] = useState<Set<PreferenceKey>>(() => new Set())
  const secretsToClearRef = useRef(new Set<PreferenceKey>())
  const [operation, setOperation] = useState<OperationState>({ status: 'idle' })
  const currentValues = useRef<Partial<PreferenceValues>>({})
  const dirty = useRef(new Set<PreferenceKey>())
  const readOnlyRef = useRef(new Set<PreferenceKey>())
  const valueHandler = useRef<(value: PreferenceValue) => void>(() => {})
  const client = useRef<PreferenceClient | undefined>(undefined)
  const generation = useRef(0)
  const received = useRef<Partial<Record<PreferenceKey, number>>>({})
  const edited = useRef<Partial<Record<PreferenceKey, number>>>({})

  valueHandler.current = ({ prop, value, configured, readOnly: isReadOnly = false }) => {
    if (!isPreferenceKey(prop)) return
    received.current[prop] = (received.current[prop] ?? 0) + 1
    const secret = SETTINGS_SCHEMA[prop].secret
    const normalized = secret ? '' : String(value ?? '')
    if (secret)
      setConfiguredSecrets((current) => {
        const next = new Set(current)
        if (configured) next.add(prop)
        else next.delete(prop)
        return next
      })
    currentValues.current[prop] = normalized
    const nextReadOnly = new Set(readOnlyRef.current)
    if (isReadOnly) {
      nextReadOnly.add(prop)
      dirty.current.delete(prop)
    } else {
      nextReadOnly.delete(prop)
    }
    readOnlyRef.current = nextReadOnly
    setReadOnly(nextReadOnly)
    if (!dirty.current.has(prop)) setValues((current) => ({ ...current, [prop]: normalized }))
  }

  if (!client.current) client.current = clientFactory((value) => valueHandler.current(value))

  useEffect(() => {
    const activeClient = client.current
    if (!activeClient) return
    activeClient.onDisconnected = () => {
      generation.current += 1
      setConnection('disconnected')
      setOperation({
        status: 'cancelled',
        message: '接続が切れました。保存されていない項目を確認してください。',
      })
      currentValues.current = {}
      dirty.current.clear()
      readOnlyRef.current = new Set()
      setReadOnly(new Set())
      setConfiguredSecrets(new Set())
      secretsToClearRef.current = new Set()
      setSecretsToClear(new Set())
    }
    return () => {
      generation.current += 1
      activeClient.onDisconnected = undefined
      activeClient.disconnect().catch(() => {})
    }
  }, [])

  const connect = useCallback(async () => {
    const activeClient = client.current
    if (!activeClient) return
    const activeGeneration = ++generation.current
    setConnection('connecting')
    setOperation({ status: 'pending', message: 'BLEデバイスを検索しています' })
    try {
      await activeClient.connect()
      if (activeGeneration !== generation.current) return
      setConnection('connected')
      setOperation({ status: 'success', result: undefined, message: 'ｽﾀｯｸﾁｬﾝへ接続しました' })
    } catch (error) {
      if (activeGeneration !== generation.current) return
      setConnection('disconnected')
      setOperation({ status: 'error', error: toAppError(error, 'ble-connect') })
    }
  }, [])

  const disconnect = useCallback(async () => {
    const activeClient = client.current
    if (!activeClient) return
    const activeGeneration = ++generation.current
    setConnection('disconnecting')
    try {
      await activeClient.disconnect()
      if (activeGeneration !== generation.current) return
      setConnection('disconnected')
      setOperation({ status: 'cancelled', message: 'BLE接続を切断しました' })
    } catch (error) {
      if (activeGeneration !== generation.current) return
      setConnection(activeClient.isConnected() ? 'connected' : 'disconnected')
      setOperation({ status: 'error', error: toAppError(error, 'ble-disconnect') })
    }
  }, [])

  const update = useCallback((key: PreferenceKey, value: string) => {
    if (readOnlyRef.current.has(key)) return
    edited.current[key] = (edited.current[key] ?? 0) + 1
    secretsToClearRef.current.delete(key)
    setSecretsToClear(new Set(secretsToClearRef.current))
    if (currentValues.current[key] === value) dirty.current.delete(key)
    else dirty.current.add(key)
    setValues((current) => ({ ...current, [key]: value }))
  }, [])

  const savePayload = useCallback(async (payload: Partial<PreferenceValues>, successMessage: string) => {
    const activeClient = client.current
    if (!activeClient?.isConnected()) return
    const activeGeneration = generation.current
    const entries = Object.entries(payload).filter(([key]) => !readOnlyRef.current.has(key as PreferenceKey))
    if (entries.length === 0) {
      setOperation({ status: 'cancelled', message: '変更する項目がありません。' })
      return
    }
    const batch = Object.fromEntries(entries)
    const receivedBefore = { ...received.current }
    const editedBefore = { ...edited.current }
    setOperation({ status: 'pending', message: '設定を保存しています' })
    try {
      for (const [key, value] of entries) {
        const validation = validateSetting(key as PreferenceKey, value)
        if (!validation.valid) throw new AppError('invalid-setting', validation.message)
      }
      const receipt = await activeClient.send({ _batch: batch })
      if (activeGeneration !== generation.current) return
      for (const [key, value] of entries) {
        const preferenceKey = key as PreferenceKey
        const secret = SETTINGS_SCHEMA[preferenceKey].secret
        const validation = validateSetting(preferenceKey, value)
        const storedValue = secret
          ? ''
          : received.current[preferenceKey] !== receivedBefore[preferenceKey]
            ? (currentValues.current[preferenceKey] ?? '')
            : String(validation.valid ? (validation.value ?? '') : value)
        currentValues.current[preferenceKey] = storedValue
        if (edited.current[preferenceKey] !== editedBefore[preferenceKey]) continue
        dirty.current.delete(preferenceKey)
        setValues((current) => ({ ...current, [preferenceKey]: storedValue }))
        secretsToClearRef.current.delete(preferenceKey)
        setSecretsToClear(new Set(secretsToClearRef.current))
        if (secret) {
          setConfiguredSecrets((current) => {
            const next = new Set(current)
            if (value) next.add(preferenceKey)
            else next.delete(preferenceKey)
            return next
          })
        }
      }
      const timing = receipt.applyFailed
        ? ' 一部の設定を反映できませんでした。再起動して確認してください。'
        : receipt.applications.includes('restart')
          ? ' 再起動すると反映されます。'
          : receipt.applications.includes('reconnect')
            ? ' Wi-Fi設定は次の接続または再起動で反映されます。'
            : ''
      setOperation({ status: 'success', result: undefined, message: successMessage + timing })
    } catch (error) {
      if (activeGeneration !== generation.current) return
      setOperation({ status: 'error', error: toAppError(error, 'preference-save') })
    }
  }, [])

  const save = useCallback(() => {
    const payload: Partial<PreferenceValues> = {}
    for (const key of dirty.current) {
      if (!readOnlyRef.current.has(key)) {
        payload[key] = values[key]
      }
    }
    return savePayload(payload, '設定の保存を本体で確認しました。')
  }, [savePayload, values])

  const clearWifi = useCallback(async () => {
    dirty.current.add('wifi.ssid')
    dirty.current.add('wifi.password')
    edited.current['wifi.ssid'] = (edited.current['wifi.ssid'] ?? 0) + 1
    edited.current['wifi.password'] = (edited.current['wifi.password'] ?? 0) + 1
    setValues((current) => ({ ...current, 'wifi.ssid': '', 'wifi.password': '' }))
    await savePayload(
      { 'wifi.ssid': '', 'wifi.password': '' },
      'Wi-Fi設定を消去しました。再起動後はオフラインになります。'
    )
  }, [savePayload])

  const clearSecret = useCallback((key: PreferenceKey) => {
    if (!SETTINGS_SCHEMA[key].secret || readOnlyRef.current.has(key)) return
    edited.current[key] = (edited.current[key] ?? 0) + 1
    if (secretsToClearRef.current.has(key)) {
      secretsToClearRef.current.delete(key)
      dirty.current.delete(key)
    } else {
      secretsToClearRef.current.add(key)
      dirty.current.add(key)
    }
    setSecretsToClear(new Set(secretsToClearRef.current))
    setValues((current) => ({ ...current, [key]: '' }))
  }, [])

  return {
    connection,
    connected: connection === 'connected',
    busy: connection === 'connecting' || connection === 'disconnecting' || operation.status === 'pending',
    values,
    readOnly,
    configuredSecrets,
    secretsToClear,
    operation,
    connect,
    disconnect,
    update,
    save,
    clearWifi,
    clearSecret,
  }
}
