export type AppLaunchBehavior = {
  onLaunch?: () => Promise<boolean> | boolean
}

export type LaunchShortcutButton = {
  read(): number
  onChanged?: (this: LaunchShortcutButton) => void
}

export function installLaunchShortcut(button: LaunchShortcutButton, open: () => unknown): void {
  const previousHandler = button.onChanged
  let opening = false
  const reset = () => (opening = false)
  button.onChanged = function () {
    previousHandler?.call(this)
    if (this.read() !== 0 || opening) return
    opening = true
    void Promise.resolve().then(open).then(reset, reset)
  }
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
