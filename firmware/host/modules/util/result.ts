import type { Maybe } from 'stackchan-util'

export type Ok<T> = { readonly ok: true; readonly value: T }
export type Err<E> = { readonly ok: false; readonly error: E }
export type Result<T, E> = Ok<T> | Err<E>
export type AsyncResult<T, E> = Promise<Result<T, E>>

export function ok<T>(value: T): Ok<T> {
  return { ok: true, value }
}

export function err<E>(error: E): Err<E> {
  return { ok: false, error }
}

export function isOk<T, E>(result: Result<T, E>): result is Ok<T> {
  return result.ok === true
}

export function isErr<T, E>(result: Result<T, E>): result is Err<E> {
  return result.ok === false
}

export function ensure<T, E>(value: T | null | undefined, onMissing: () => E): Result<T, E> {
  return value != null ? ok(value) : err(onMissing())
}

export function fromMaybe<T, E>(maybe: Maybe<T>, mapReason: (reason?: string) => E): Result<T, E> {
  if ('value' in maybe && maybe.success) {
    return ok(maybe.value)
  }
  const reason = 'reason' in maybe ? maybe.reason : undefined
  return err(mapReason(reason))
}

export async function fromPromise<T, E>(promise: Promise<T>, mapError: (cause: unknown) => E): AsyncResult<T, E> {
  try {
    return ok(await promise)
  } catch (cause) {
    return err(mapError(cause))
  }
}

export function map<T, U, E>(result: Result<T, E>, fn: (value: T) => U): Result<U, E> {
  return isOk(result) ? ok(fn(result.value)) : result
}

export function mapErr<T, E1, E2>(result: Result<T, E1>, fn: (error: E1) => E2): Result<T, E2> {
  return isErr(result) ? err(fn(result.error)) : result
}

export function andThen<T, U, E1, E2>(result: Result<T, E1>, fn: (value: T) => Result<U, E2>): Result<U, E1 | E2> {
  return isOk(result) ? fn(result.value) : result
}

export async function andThenAsync<T, U, E1, E2>(
  result: Result<T, E1> | AsyncResult<T, E1>,
  fn: (value: T) => Result<U, E2> | AsyncResult<U, E2>,
): AsyncResult<U, E1 | E2> {
  const resolved = await result
  return isOk(resolved) ? fn(resolved.value) : resolved
}

export function match<T, E, R>(
  result: Result<T, E>,
  handlers: { readonly ok: (value: T) => R; readonly err: (error: E) => R },
): R {
  return isOk(result) ? handlers.ok(result.value) : handlers.err(result.error)
}

export type ResourceScope = Readonly<{
  acquire<T, E>(
    open: () => Result<T, E> | AsyncResult<T, E>,
    close: (resource: T) => void | Promise<void>,
  ): AsyncResult<T, E>
}>

export type ScopedValue<T> = Readonly<{
  value: T
  close(): Promise<void>
}>

export async function withResourceScope<T, E>(
  run: (scope: ResourceScope) => AsyncResult<T, E>,
): AsyncResult<ScopedValue<T>, E> {
  const cleanups: Array<() => void | Promise<void>> = []
  let closing: Promise<void> | undefined

  const closeResources = async (): Promise<void> => {
    let firstError: unknown
    let hasError = false
    for (let i = cleanups.length - 1; i >= 0; i -= 1) {
      try {
        await cleanups[i]()
      } catch (cause) {
        if (!hasError) {
          firstError = cause
          hasError = true
        }
      }
    }
    cleanups.length = 0
    if (hasError) throw firstError
  }

  const closeAll = () => (closing ??= Promise.resolve().then(closeResources))

  const scope: ResourceScope = {
    async acquire(open, close) {
      const opened = await open()
      if (isOk(opened)) {
        if (closing) {
          try {
            await close(opened.value)
          } catch {}
        } else {
          cleanups.push(() => close(opened.value))
        }
      }
      return opened
    },
  }

  try {
    const result = await run(scope)
    if (isErr(result)) {
      await closeAll()
      return result
    }
    return ok({ value: result.value, close: closeAll })
  } catch (cause) {
    await closeAll()
    throw cause
  }
}
