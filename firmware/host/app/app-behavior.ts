import type { StackchanContext } from 'capabilities'

export type StackchanAppBehavior = {
  onLaunch?: () => Promise<boolean> | boolean
  onContextCreated?: (context: StackchanContext, option?: unknown) => Promise<void> | void
}

export async function runLaunchBehaviors(behaviors: StackchanAppBehavior[]): Promise<boolean> {
  for (const behavior of behaviors) {
    if ((await (behavior.onLaunch?.() ?? true)) === false) {
      return false
    }
  }
  return true
}

export async function runContextCreatedBehaviors(
  behaviors: StackchanAppBehavior[],
  context: StackchanContext,
  option?: unknown,
): Promise<void> {
  for (const behavior of behaviors) {
    await behavior.onContextCreated?.(context, option)
  }
}
