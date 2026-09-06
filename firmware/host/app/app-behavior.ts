import type { PreferenceConfig } from 'loadPreference'
import type { StackchanContext } from 'capabilities'

export type StackchanAppBehaviorOption = {
  device?: unknown
  config: PreferenceConfig
}

export type StackchanAppBehavior = {
  onLaunch?: () => Promise<boolean> | boolean
  onContextCreated?: (context: StackchanContext, option: StackchanAppBehaviorOption) => Promise<void> | void
}
