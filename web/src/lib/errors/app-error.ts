export class AppError extends Error {
  readonly code: string

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'AppError'
    this.code = code
  }
}

export const toAppError = (error: unknown, fallbackCode = 'unknown') => {
  if (error instanceof AppError) return error
  if (error instanceof Error) return new AppError(fallbackCode, error.message, { cause: error })
  return new AppError(fallbackCode, String(error))
}
