import type { PreferenceConfig } from 'loadPreference'
import type { StackchanContext } from 'capabilities'

export { runLaunchBehaviors } from 'app-launch'

export type StackchanAppBehaviorOption = {
  device?: unknown
  config: PreferenceConfig
}

export type StackchanAppBehavior = {
  onLaunch?: () => Promise<boolean> | boolean
  onContextCreated?: (context: StackchanContext, option: StackchanAppBehaviorOption) => Promise<void> | void
}

export async function runContextCreatedBehaviors(
  behaviors: StackchanAppBehavior[],
  context: StackchanContext,
  option: StackchanAppBehaviorOption,
): Promise<void> {
  for (const behavior of behaviors) {
    await behavior.onContextCreated?.(context, option)
  }
}
