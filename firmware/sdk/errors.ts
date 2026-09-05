export type StackchanErrorCode =
  | 'INVALID_ARGUMENT'
  | 'UNSUPPORTED'
  | 'BUSY'
  | 'TIMEOUT'
  | 'CANCELLED'
  | 'CLOSED'
  | 'IO'
  | 'CONFIG'

/** Stable control-flow codes; applications must not parse provider messages. */
export class StackchanError extends Error {
  readonly code: StackchanErrorCode

  constructor(code: StackchanErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options)
    // XS preloads freeze Error.prototype; assignment cannot shadow its name.
    Object.defineProperty(this, 'name', { value: 'StackchanError', configurable: true, writable: true })
    this.code = code
  }
}

export function asStackchanError(error: unknown, code: StackchanErrorCode = 'IO'): StackchanError {
  if (error instanceof StackchanError) return error
  return new StackchanError(code, error instanceof Error ? error.message : String(error), { cause: error })
}

export function finiteNumber(value: number, name: string, minimum: number, maximum = Number.MAX_VALUE): void {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new StackchanError('INVALID_ARGUMENT', `${name} must be between ${minimum} and ${maximum}`)
  }
}
