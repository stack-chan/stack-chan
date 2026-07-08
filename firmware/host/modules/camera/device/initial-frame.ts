import Timer from 'timer'

export type InitialCameraFrameOptions<T> = {
  isCurrent: () => boolean
  onTimeout?: () => void
  pollMs?: number
  takeFrame: () => T | undefined
  timeoutMs?: number
}

export function waitForInitialCameraFrame<T>({
  isCurrent,
  onTimeout,
  pollMs = 30,
  takeFrame,
  timeoutMs = 500,
}: InitialCameraFrameOptions<T>): Promise<T | undefined> {
  return new Promise((resolve) => {
    let elapsed = 0
    let timer: ReturnType<typeof Timer.repeat> | undefined

    const finish = (frame: T | undefined) => {
      if (timer !== undefined) {
        Timer.clear(timer)
        timer = undefined
      }
      resolve(frame)
    }

    const poll = () => {
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
    }

    timer = Timer.repeat(poll, pollMs)
    poll()
  })
}
