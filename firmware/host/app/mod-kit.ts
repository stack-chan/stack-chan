import type { StackchanAppBehavior, StackchanAppBehaviorOption } from 'app-behavior'
import type { StackchanContext } from 'capabilities'
import { type CloseHandler, OwnedResources } from 'owned-resources'
import { type AsyncResult, isErr, type Result } from 'stackchan-result'

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

      const close = (): Promise<void> => {
        if (!closing) {
          const snapshot = handlers.splice(0, handlers.length)
          closing = new OwnedResources(snapshot).close()
        }
        return closing
      }

      const scope: ModScope = {
        own(cleanup) {
          if (closing) {
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
        await close()
        throw error
      }
      const rollbackSync = (error: unknown): Promise<never> | never => {
        if (closeActive === close) closeActive = undefined
        if (!closing) {
          const snapshot = handlers.splice(0, handlers.length)
          let index = 0
          for (; index < snapshot.length; index += 1) {
            try {
              const step = snapshot[index]()
              if (isPromiseLike<void>(step)) {
                const remaining = snapshot.slice(index + 1)
                closing = Promise.resolve(step)
                  .catch(() => {})
                  .then(() => new OwnedResources(remaining).close())
                return closing.then(() => {
                  throw error
                })
              }
            } catch {}
          }
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
