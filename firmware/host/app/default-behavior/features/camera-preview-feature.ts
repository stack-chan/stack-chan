import type { ModFeature, ModScope } from 'mod-kit'
import { ok, type Result } from 'stackchan-result'
import Timer from 'timer'

const CAMERA_PREVIEW_DURATION_MS = 5000
const CAMERA_PREVIEW_STOP_DELAY_MS = 120
// Capture at the GC0308's native QQVGA size. The preview renderer scales this
// to 200x120; requesting 200 pixels wide selects the larger 240x176 mode and
// increases both the contiguous DMA requirement and frame overflow pressure.
const CAMERA_PREVIEW_CAPTURE_WIDTH = 160
const CAMERA_PREVIEW_CAPTURE_HEIGHT = 120

export type CameraPreviewImageType = 'rgb565be' | 'rgb565le'

export type CameraPreviewCapturedFrame = {
  close?(): void
}

export type CameraPreviewPreparedFrame = {
  width: number
  height: number
  imageType: string
}

export type CameraPreviewCameraPort<TFrame extends CameraPreviewCapturedFrame = CameraPreviewCapturedFrame> = {
  readonly available?: boolean
  start(options: { width: number; height: number; imageType: CameraPreviewImageType }): Promise<void> | void
  capture(options: { width: number; height: number; imageType: CameraPreviewImageType }): Promise<TFrame | undefined>
  stop(): Promise<void> | void
}

export type CameraPreviewTimerHandle = unknown

export type CameraPreviewTimer = Readonly<{
  set(callback: () => void, interval: number): CameraPreviewTimerHandle
  clear(handle: CameraPreviewTimerHandle): void
}>

export type CameraPreviewFeatureDeps<
  TFrame extends CameraPreviewCapturedFrame = CameraPreviewCapturedFrame,
  TPrepared extends CameraPreviewPreparedFrame = CameraPreviewPreparedFrame,
  TDialog = unknown,
> = Readonly<{
  camera: CameraPreviewCameraPort<TFrame>
  captureImageType: CameraPreviewImageType
  prepareFrame(frame: TFrame): TPrepared
  createDialog(
    preview: TPrepared,
    options: {
      onRender: (mode: string) => void
      onDismiss: () => void
    },
  ): TDialog
  setMain(content: TDialog, options?: { onClose?: () => void }): unknown
  showFace(): void
  closeDrawer(): void
  showBalloon(text: string): void
  hideBalloon(): void
  hideBalloonLater(delayMs: number): void
  localize(key: string): string
  addDrawerButton(button: { key: string; label: string; icon: 'camera'; callback: () => Promise<void> }): void
  timer?: CameraPreviewTimer
  log?: (message: string) => void
}>

export type CameraPreviewFeatureError = {
  readonly feature: 'camera-preview'
  readonly reason: string
}

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message)
  }
  return String(error)
}

export function installCameraPreviewFeature<
  TFrame extends CameraPreviewCapturedFrame,
  TPrepared extends CameraPreviewPreparedFrame,
  TDialog,
>(
  deps: CameraPreviewFeatureDeps<TFrame, TPrepared, TDialog>,
  scope: ModScope,
): Result<void, CameraPreviewFeatureError> {
  if (deps.camera.available === false) return ok(undefined)

  const timer: CameraPreviewTimer = deps.timer ?? {
    set: (callback, interval) => Timer.set(callback, interval),
    clear: (handle) => Timer.clear(handle as ReturnType<typeof Timer.set>),
  }
  const log = deps.log ?? ((message: string) => trace(message))

  let disposed = false
  let cameraPreviewTimer: CameraPreviewTimerHandle | undefined
  let cameraStopTimer: CameraPreviewTimerHandle | undefined
  let resolvePendingStop: (() => void) | undefined

  const clearPreviewTimer = (): void => {
    if (cameraPreviewTimer !== undefined) {
      timer.clear(cameraPreviewTimer)
      cameraPreviewTimer = undefined
    }
  }

  const clearStopTimer = (): void => {
    if (cameraStopTimer !== undefined) {
      timer.clear(cameraStopTimer)
      cameraStopTimer = undefined
    }
    const resolveStop = resolvePendingStop
    resolvePendingStop = undefined
    resolveStop?.()
  }

  const restoreCameraPreview = (): void => {
    clearPreviewTimer()
    if (disposed) return
    deps.showFace()
    deps.hideBalloon()
  }

  const stopCameraAfterPreviewPaint = (): Promise<void> =>
    new Promise<void>((resolve) => {
      if (disposed) {
        resolve()
        return
      }
      clearStopTimer()
      resolvePendingStop = resolve
      cameraStopTimer = timer.set(() => {
        cameraStopTimer = undefined
        const done = () => {
          if (resolvePendingStop === resolve) resolvePendingStop = undefined
          resolve()
        }
        try {
          log('[CameraPreview] camera stop begin\n')
          const result = deps.camera.stop()
          if (result && typeof (result as { then?: unknown }).then === 'function') {
            ;(result as Promise<void>).then(
              () => {
                log('[CameraPreview] camera stop done\n')
                done()
              },
              (stopError: unknown) => {
                log(`[CameraPreview] stop error ${errorMessage(stopError)}\n`)
                done()
              },
            )
          } else {
            log('[CameraPreview] camera stop done\n')
            done()
          }
        } catch (stopError) {
          log(`[CameraPreview] stop error ${errorMessage(stopError)}\n`)
          done()
        }
      }, CAMERA_PREVIEW_STOP_DELAY_MS)
    })

  const runCameraPreview = async (): Promise<void> => {
    if (disposed) return
    let frame: TFrame | undefined
    try {
      deps.showBalloon('starting camera...')
      await deps.camera.start({
        width: CAMERA_PREVIEW_CAPTURE_WIDTH,
        height: CAMERA_PREVIEW_CAPTURE_HEIGHT,
        imageType: deps.captureImageType,
      })
      if (disposed) return
      frame = await deps.camera.capture({
        width: CAMERA_PREVIEW_CAPTURE_WIDTH,
        height: CAMERA_PREVIEW_CAPTURE_HEIGHT,
        imageType: deps.captureImageType,
      })
      if (disposed) return
      if (!frame) {
        log('[CameraPreview] capture returned no frame\n')
        deps.showBalloon('camera unavailable')
        return
      }
      const previewFrame = deps.prepareFrame(frame)
      deps.setMain(
        deps.createDialog(previewFrame, {
          onRender: (mode) => {
            log(`[CameraPreview] render mode=${mode}\n`)
          },
          onDismiss: restoreCameraPreview,
        }),
        { onClose: clearPreviewTimer },
      )
      log(
        `[CameraPreview] rendered ${previewFrame.width}x${previewFrame.height} ${previewFrame.imageType} via Piu Port\n`,
      )
      deps.closeDrawer()
      clearPreviewTimer()
      cameraPreviewTimer = timer.set(restoreCameraPreview, CAMERA_PREVIEW_DURATION_MS)
    } catch (error) {
      log(`[CameraPreview] error ${errorMessage(error)}\n`)
      if (!disposed) {
        try {
          deps.showBalloon('camera error')
        } catch (balloonError) {
          log(`[CameraPreview] error balloon failed ${errorMessage(balloonError)}\n`)
        }
      }
    } finally {
      if (frame) {
        log('[CameraPreview] frame close begin\n')
        frame.close?.()
        log('[CameraPreview] frame close done\n')
      }
      await stopCameraAfterPreviewPaint()
      if (!disposed) deps.hideBalloonLater(1200)
    }
  }

  deps.addDrawerButton({
    key: 'cameraPreview',
    label: deps.localize('drawer.camera'),
    icon: 'camera',
    callback: runCameraPreview,
  })

  scope.own(() => {
    disposed = true
    clearPreviewTimer()
    clearStopTimer()
  })

  return ok(undefined)
}

export function createCameraPreviewFeature<
  TDeps,
  TFrame extends CameraPreviewCapturedFrame = CameraPreviewCapturedFrame,
  TPrepared extends CameraPreviewPreparedFrame = CameraPreviewPreparedFrame,
  TDialog = unknown,
>(
  selectDeps: (deps: TDeps) => CameraPreviewFeatureDeps<TFrame, TPrepared, TDialog>,
): ModFeature<TDeps, CameraPreviewFeatureError> {
  return (deps, scope) => installCameraPreviewFeature(selectDeps(deps), scope)
}
