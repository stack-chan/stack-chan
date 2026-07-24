import { useCallback, useEffect, useRef, useState } from 'react'

import { type OperationState } from '@/features/operations/operation-state'
import { useLogBuffer } from '@/hooks/use-log-buffer'
import { toAppError } from '@/lib/errors/app-error'
import {
  type CameraStatus,
  type InstalledMod,
  type SimulatorModResult,
  SimulatorEngine,
} from '@/services/simulator/simulator-engine.mjs'

type ModState = {
  result: SimulatorModResult
  installedMod?: InstalledMod | null
}

export function useSimulatorEngine() {
  const viewportRef = useRef<HTMLCanvasElement>(null)
  const screenRef = useRef<HTMLCanvasElement>(null)
  const engineRef = useRef<SimulatorEngine | null>(null)
  const [operation, setOperation] = useState<OperationState>({ status: 'idle' })
  const [modState, setModState] = useState<ModState>({ result: { status: 'empty' } })
  const [cameraStatus, setCameraStatus] = useState<CameraStatus>({ status: 'idle' })
  const { entries, append, clear } = useLogBuffer(120)

  useEffect(() => {
    const viewport = viewportRef.current
    const screen = screenRef.current
    if (!viewport || !screen) return
    let active = true
    const engine = new SimulatorEngine({
      viewport,
      screen,
      onStatus: (status) => {
        if (!active) return
        if (status.status === 'pending') {
          setOperation({ status: 'pending', message: status.message })
        } else if (status.status === 'success') {
          setOperation({ status: 'success', result: undefined, message: status.message })
        } else {
          setOperation({ status: 'error', error: toAppError(status.message, 'simulator') })
        }
      },
      onTrace: (message) => {
        if (!active) return
        append(message, message.startsWith('[err]') ? 'error' : 'trace', 'simulator')
      },
      onModStatus: (result, installedMod) => {
        if (active) setModState({ result, installedMod })
      },
      onCameraStatus: (status) => {
        if (active) setCameraStatus(status)
      },
    })
    engineRef.current = engine
    void engine.start().catch((error) => {
      if (active) setOperation({ status: 'error', error: toAppError(error, 'simulator.start') })
    })
    return () => {
      active = false
      if (engineRef.current === engine) engineRef.current = null
      engine.dispose()
    }
  }, [append])

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
