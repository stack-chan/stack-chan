import { type AppError } from '@/lib/errors/app-error'

export type OperationState<T = unknown> =
  | { status: 'idle' }
  | { status: 'pending'; message?: string; progress?: number }
  | { status: 'success'; result: T; message?: string }
  | { status: 'cancelled'; message?: string }
  | { status: 'error'; error: AppError }
