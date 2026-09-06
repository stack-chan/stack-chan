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

export async function runLaunchBehaviors(behaviors: AppLaunchBehavior[]): Promise<boolean> {
  for (const behavior of behaviors) {
    if ((await (behavior.onLaunch?.() ?? true)) === false) return false
  }
  return true
}
