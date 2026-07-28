export type AppLaunchBehavior = {
  onLaunch?: () => Promise<boolean> | boolean
}

export type AppLaunchPreparation<TPrepared> =
  | Readonly<{ shouldCreateContext: false }>
  | Readonly<{ shouldCreateContext: true; prepared: TPrepared }>

export async function runLaunchBehaviors(behaviors: AppLaunchBehavior[]): Promise<boolean> {
  for (const behavior of behaviors) {
    if ((await (behavior.onLaunch?.() ?? true)) === false) return false
  }
  return true
}

export async function prepareAppLaunch<TPrepared>(
  behaviors: AppLaunchBehavior[],
  prepareAfterApproval: () => TPrepared,
): Promise<AppLaunchPreparation<TPrepared>> {
  const shouldCreateContext = await runLaunchBehaviors(behaviors)
  if (!shouldCreateContext) return { shouldCreateContext: false }
  return {
    shouldCreateContext: true,
    prepared: prepareAfterApproval(),
  }
}
