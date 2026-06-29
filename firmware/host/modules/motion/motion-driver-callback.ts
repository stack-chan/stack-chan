import type { MotionCompletion, MotionResultCallback } from 'motion-controller'
import type { Maybe } from 'stackchan-util'

function reasonFromError(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message)
  }
  return String(error)
}

export function notifyCompletion(operation: Promise<unknown>, callback?: MotionCompletion): void {
  operation.then(
    () => callback?.(),
    (error) => callback?.(error),
  )
}

export function notifyMaybe<T>(
  operation: Promise<Maybe<T> | undefined>,
  callback: MotionResultCallback<Maybe<T>>,
): void {
  operation.then(
    (result) => callback(result ?? { success: false, reason: 'response unavailable' }),
    (error) => callback({ success: false, reason: reasonFromError(error) }),
  )
}
