import type { StackchanContext } from 'capabilities'
import type { AsyncResult, Result } from 'stackchan-result'

export type ModCloseHandler = () => Promise<void> | void

export type ModScope = Readonly<{
  own(cleanup: ModCloseHandler): void
}>

export type ModBehaviorOption = {
  config: {
    [domain: string]: unknown
  }
}

export type ModBehavior = {
  onLaunch?: (option: { config?: unknown }) => Promise<boolean> | boolean
  onContextCreated?: (robot: StackchanContext, option: ModBehaviorOption) => Promise<void> | void
  onClose?: () => Promise<void> | void
}

export type ModSetup = (
  context: StackchanContext,
  option: ModBehaviorOption,
  scope: ModScope,
) => Promise<void> | void

export type ModDefinition = Readonly<{
  onLaunch?: ModBehavior['onLaunch']
  setup: ModSetup
}>

export type ModFeature<TDeps, TError> = (
  deps: TDeps,
  scope: ModScope,
) => Result<void, TError> | AsyncResult<void, TError>

export declare function defineMod(spec: ModDefinition): ModBehavior

export declare function composeFeatures<TDeps, TError>(
  deps: TDeps,
  scope: ModScope,
  features: readonly ModFeature<TDeps, TError>[],
  onFeatureError: (error: TError) => void,
): Promise<void> | void
