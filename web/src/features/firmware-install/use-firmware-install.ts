import { useCallback, useEffect, useRef, useState } from 'react'

import { type FirmwareBoard } from '@/features/firmware-install/boards'
import { toAppError, type AppError } from '@/lib/errors/app-error'
import {
  installFirmware,
  type FirmwareDeviceInfo,
  type FirmwareInstallResult,
} from '@/services/firmware-install/firmware-install-service'

export type InstallState =
  | { status: 'idle' }
  | { status: 'selecting-port' }
  | { status: 'inspecting-device' }
  | { status: 'confirming'; device: FirmwareDeviceInfo }
  | { status: 'installing'; progress: number }
  | { status: 'success'; result: FirmwareInstallResult }
  | { status: 'cancelled' }
  | { status: 'error'; error: AppError }

type SerialNavigator = Navigator & {
  serial?: {
    requestPort: () => Promise<Parameters<typeof installFirmware>[0]>
  }
}

export function useFirmwareInstall(onLog: (message: string, level?: 'info' | 'warning' | 'error') => void) {
  const [state, setState] = useState<InstallState>({ status: 'idle' })
  const confirmation = useRef<((approved: boolean) => void) | null>(null)

  useEffect(
    () => () => {
      confirmation.current?.(false)
      confirmation.current = null
    },
    []
  )

  const install = useCallback(
    async (board: FirmwareBoard) => {
      if (!isSecureContext) {
        setState({
          status: 'error',
          error: toAppError(new Error('書き込みにはHTTPS接続が必要です。'), 'insecure-context'),
        })
        return
      }
      const serial = (navigator as SerialNavigator).serial
      if (!serial) {
        setState({
          status: 'error',
          error: toAppError(new Error('このブラウザはWeb Serialに対応していません。'), 'unsupported'),
        })
        return
      }

      try {
        setState({ status: 'selecting-port' })
        onLog('接続するUSBデバイスを選択してください')
        const port = await serial.requestPort()
        const result = await installFirmware(port, board, {
          onLog: (message) => onLog(message),
          onStage: (stage) => {
            if (stage === 'inspecting') setState({ status: 'inspecting-device' })
            else setState({ status: 'installing', progress: 0 })
          },
          onProgress: (progress) => setState({ status: 'installing', progress }),
          onConfirm: (device) =>
            new Promise<boolean>((resolve) => {
              confirmation.current = resolve
              setState({ status: 'confirming', device })
            }),
        })
        confirmation.current = null
        if (result) {
          onLog('ファームウェア書き込みが成功しました')
          setState({ status: 'success', result })
        } else {
          setState({ status: 'cancelled' })
        }
      } catch (error) {
        confirmation.current = null
        if (error instanceof DOMException && error.name === 'NotFoundError') {
          onLog('USBデバイスの選択をキャンセルしました', 'warning')
          setState({ status: 'cancelled' })
          return
        }
        const appError = toAppError(error, 'firmware-install')
        onLog(appError.message, 'error')
        setState({ status: 'error', error: appError })
      }
    },
    [onLog]
  )

  const resolveConfirmation = useCallback((approved: boolean) => {
    const resolve = confirmation.current
    confirmation.current = null
    resolve?.(approved)
    if (!approved) setState({ status: 'cancelled' })
    else setState({ status: 'installing', progress: 0 })
  }, [])

  const reset = useCallback(() => setState({ status: 'idle' }), [])
  return { state, install, confirm: () => resolveConfirmation(true), cancel: () => resolveConfirmation(false), reset }
}
