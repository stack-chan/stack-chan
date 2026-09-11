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
