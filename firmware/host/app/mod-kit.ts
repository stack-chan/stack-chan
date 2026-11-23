import type { StackchanAppBehavior, StackchanAppBehaviorOption } from 'app-behavior'
import type { StackchanContext } from 'capabilities'
import type { CloseHandler } from 'owned-resources'
import { type AsyncResult, isErr, type Result } from 'stackchan-result'

export type { StackchanAppBehavior, StackchanAppBehaviorOption } from 'app-behavior'
export type ModCloseHandler = CloseHandler
export type ModBehavior = StackchanAppBehavior
export type ModBehaviorOption = StackchanAppBehaviorOption

export type ModScope = Readonly<{
  own(cleanup: CloseHandler): void
}>

export type ModSetup = (
  context: StackchanContext,
  option: StackchanAppBehaviorOption,
  scope: ModScope,
) => Promise<void> | void

export type ModDefinition = Readonly<{
  onLaunch?: StackchanAppBehavior['onLaunch']
  setup: ModSetup
}>

function isPromiseLike<T>(value: unknown): value is PromiseLike<T> {
  return (
    (typeof value === 'object' || typeof value === 'function') &&
    value !== null &&
    'then' in value &&
    typeof (value as { then?: unknown }).then === 'function'
  )
}

export function defineMod(spec: ModDefinition): StackchanAppBehavior {
  let closeActive: (() => Promise<void>) | undefined

  return {
    ...(spec.onLaunch ? { onLaunch: spec.onLaunch } : {}),
    onContextCreated(context, option) {
      const handlers: CloseHandler[] = []
      let closing: Promise<void> | undefined
      let closingStarted = false
      let drainActive = false

      const drainRemainingAsync = async (initialError?: unknown): Promise<void> => {
        let firstError = initialError
        let hasError = initialError !== undefined
        try {
          while (handlers.length > 0) {
            const handler = handlers.shift()
            if (!handler) continue
            try {
              await handler()
            } catch (error) {
              if (!hasError) {
                firstError = error
                hasError = true
              }
            }
          }
        } finally {
          drainActive = false
        }
        if (hasError) throw firstError
      }

      const close = (): Promise<void> => {
        if (!closing) {
          closingStarted = true
          drainActive = true
          closing = drainRemainingAsync()
        }
        return closing
      }

      const scope: ModScope = {
        own(cleanup) {
          if (closingStarted && !drainActive) {
            void Promise.resolve()
              .then(() => cleanup())
              .catch((error) => {
                if (typeof trace === 'function') trace(`[mod-kit] late cleanup failed: ${String(error)}\n`)
              })
            return
          }
          handlers.unshift(cleanup)
        },
      }

      closeActive = close
      const rollbackAsync = async (error: unknown): Promise<never> => {
        if (closeActive === close) closeActive = undefined
        try {
          await close()
        } catch {}
        throw error
      }
      const rollbackSync = (error: unknown): Promise<never> | never => {
        if (closeActive === close) closeActive = undefined
        if (!closingStarted) {
          closingStarted = true
          drainActive = true
          while (handlers.length > 0) {
            const handler = handlers.shift()
            if (!handler) continue
            try {
              const step = handler()
              if (isPromiseLike<void>(step)) {
                closing = Promise.resolve(step)
                  .catch(() => {})
                  .then(() => drainRemainingAsync().catch(() => {}))
                return closing.then(() => {
                  throw error
                })
              }
            } catch {}
          }
          drainActive = false
          closing = Promise.resolve()
        }
        throw error
      }
      try {
        const result = spec.setup(context, option, scope)
        if (isPromiseLike<void>(result)) {
          return Promise.resolve(result).catch(rollbackAsync)
        }
        return undefined
      } catch (error) {
        return rollbackSync(error)
      }
    },
    async onClose() {
      const close = closeActive
      closeActive = undefined
      await close?.()
    },
  }
}

export type ModFeature<TDeps, TError> = (
  deps: TDeps,
  scope: ModScope,
) => Result<void, TError> | AsyncResult<void, TError>

export function composeFeatures<TDeps, TError>(
  deps: TDeps,
  scope: ModScope,
  features: readonly ModFeature<TDeps, TError>[],
  onFeatureError: (error: TError) => void,
): Promise<void> | void {
  const runFrom = (startIndex: number): Promise<void> | void => {
    for (let index = startIndex; index < features.length; index += 1) {
      const result = features[index](deps, scope)
      if (isPromiseLike<Result<void, TError>>(result)) {
        return Promise.resolve(result).then((resolved) => {
          if (isErr(resolved)) onFeatureError(resolved.error)
          return runFrom(index + 1)
        })
      }
      if (isErr(result)) onFeatureError(result.error)
    }
  }
  return runFrom(0)
}
