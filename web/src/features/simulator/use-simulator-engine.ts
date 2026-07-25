import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { useI18n } from '@/app/i18n-provider'
import { type OperationState } from '@/features/operations/operation-state'
import { useLogBuffer } from '@/hooks/use-log-buffer'
import { toAppError } from '@/lib/errors/app-error'
import {
  type CameraStatus,
  type InstalledMod,
  type SimulatorModStorage,
  type SimulatorModResult,
  type SimulatorReady,
  type SimulatorStatusCode,
  SimulatorEngine,
} from '@/services/simulator/simulator-engine.mjs'
import { createMemoryModStorage, createModStorage } from '../../../simulator/mod-storage.mjs'

type ModState = {
  result: SimulatorModResult
  installedMod?: InstalledMod | null
}

type SimulatorEngineOptions = {
  initialMod?: {
    name: string
    bytes: Uint8Array
  }
  persistence?: 'persistent' | 'session'
  runtimeBaseUrl?: string
  onTrace?: (message: string) => void
  onReady?: (ready: SimulatorReady) => void
  onError?: (error: unknown) => void
}

const SIMULATOR_STATUS_MESSAGES: Record<SimulatorStatusCode, string> = {
  'wasm-loading': 'WASMを読み込み中',
  'wasm-load-failed': 'WASMを読み込めませんでした',
  'firmware-ready-timeout': 'ファームウェアの起動準備がタイムアウトしました',
  'firmware-ready': '準備完了',
}

export function useSimulatorEngine({
  initialMod,
  persistence = 'persistent',
  runtimeBaseUrl = new URL('../simulator/', document.baseURI).href,
  onTrace,
  onReady,
  onError,
}: SimulatorEngineOptions = {}) {
  const { t } = useI18n()
  const viewportRef = useRef<HTMLCanvasElement>(null)
  const screenRef = useRef<HTMLCanvasElement>(null)
  const engineRef = useRef<SimulatorEngine | null>(null)
  const callbacksRef = useRef({ onTrace, onReady, onError, t })
  const [operation, setOperation] = useState<OperationState>({ status: 'idle' })
  const [modState, setModState] = useState<ModState>({ result: { status: 'empty' } })
  const [cameraStatus, setCameraStatus] = useState<CameraStatus>({ status: 'idle' })
  const { entries, append, clear } = useLogBuffer(120)

  useLayoutEffect(() => {
    callbacksRef.current = { onTrace, onReady, onError, t }
  }, [onError, onReady, onTrace, t])

  useEffect(() => {
    const viewport = viewportRef.current
    const screen = screenRef.current
    if (!viewport || !screen) return
    let active = true
    const modStorage = (
      persistence === 'session' ? createMemoryModStorage() : createModStorage()
    ) as SimulatorModStorage
    const engine = new SimulatorEngine({
      viewport,
      screen,
      modStorage,
      runtimeBaseUrl,
      onStatus: (status) => {
        if (!active) return
        const message = callbacksRef.current.t(SIMULATOR_STATUS_MESSAGES[status.code])
        if (status.status === 'pending') {
          setOperation({ status: 'pending', message })
        } else if (status.status === 'success') {
          setOperation({ status: 'success', result: undefined, message })
        } else {
          setOperation({ status: 'error', error: toAppError(message, 'simulator') })
        }
      },
      onTrace: (message) => {
        if (!active) return
        append(message, message.startsWith('[err]') ? 'error' : 'trace', 'simulator')
        callbacksRef.current.onTrace?.(message)
      },
      onModStatus: (result, installedMod) => {
        if (active) setModState({ result, installedMod })
      },
      onCameraStatus: (status) => {
        if (active) setCameraStatus(status)
      },
      onReady: (ready) => {
        if (active) callbacksRef.current.onReady?.(ready)
      },
      onError: (error) => {
        if (active) callbacksRef.current.onError?.(error)
      },
    })
    engineRef.current = engine
    void (async () => {
      if (initialMod) await modStorage.saveInstalledMod(initialMod)
      if (active) await engine.start()
    })().catch((error) => {
      if (!active) return
      setOperation({ status: 'error', error: toAppError(error, 'simulator.start') })
      callbacksRef.current.onError?.(error)
    })
    return () => {
      active = false
      if (engineRef.current === engine) engineRef.current = null
      engine.dispose()
    }
  }, [append, initialMod?.bytes, initialMod?.name, persistence, runtimeBaseUrl])

  const run = useCallback(async (action: (engine: SimulatorEngine) => Promise<void>) => {
    const engine = engineRef.current
    if (!engine) return
    try {
      await action(engine)
    } catch (error) {
      setOperation({ status: 'error', error: toAppError(error, 'simulator.action') })
    }
  }, [])

  return {
    viewportRef,
    screenRef,
    operation,
    modState,
    cameraStatus,
    logs: entries,
    clearLogs: clear,
    installMod: (file: File) => run((engine) => engine.installMod(file)),
    restart: () => run((engine) => engine.restart()),
    clearMod: () => run((engine) => engine.clearMod()),
    connectCamera: () => run((engine) => engine.connectCamera()),
    pushButton: (name: 'a' | 'b' | 'c') => engineRef.current?.pushButton(name),
  }
}
