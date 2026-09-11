import Timer from 'timer'

export type InitialCameraFrameOptions<T> = {
  isCurrent: () => boolean
  onTimeout?: () => void
  pollMs?: number
  takeFrame: () => T | undefined
  timeoutMs?: number
  subscribeCancellation?: (cancel: () => void) => () => void
}

export function waitForInitialCameraFrame<T>({
  isCurrent,
  onTimeout,
  pollMs = 30,
  takeFrame,
  timeoutMs = 500,
  subscribeCancellation,
}: InitialCameraFrameOptions<T>): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    let elapsed = 0
    let timer: ReturnType<typeof Timer.repeat> | undefined
    let unsubscribe: (() => void) | undefined
    let finished = false

    const finish = (frame: T | undefined, error?: unknown) => {
      if (finished) return
      finished = true
      if (timer !== undefined) {
        Timer.clear(timer)
        timer = undefined
      }
      unsubscribe?.()
      if (error !== undefined) reject(error)
      else resolve(frame)
    }

    const poll = () => {
      if (finished) return
      try {
        if (!isCurrent()) {
          finish(undefined)
          return
        }

        const frame = takeFrame()
        if (frame) {
          finish(frame)
          return
        }

        elapsed += pollMs
        if (elapsed >= timeoutMs) {
          onTimeout?.()
          finish(undefined)
        }
      } catch (error) {
        finish(undefined, error)
      }
    }

    try {
      unsubscribe = subscribeCancellation?.(() => finish(undefined))
      if (finished) {
        unsubscribe?.()
        return
      }
      timer = Timer.repeat(poll, pollMs)
      poll()
    } catch (error) {
      finish(undefined, error)
    }
  })
}
