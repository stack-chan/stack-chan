import type { MotionCompletion, MotionResultCallback } from 'motion-controller'
import type { Maybe } from 'stackchan-util'

export function reasonFromError(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message)
  }
  return String(error)
}

export function notifyCompletion(callback?: MotionCompletion, error?: unknown): void {
  callback?.(error)
}

export function notifyMaybeFailure<T>(callback: MotionResultCallback<Maybe<T>>, error: unknown): void {
  callback({ success: false, reason: reasonFromError(error) })
}
