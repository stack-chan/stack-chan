export type StartupChoice = 'boot' | 'settings'

export const STARTUP_AUTO_BOOT_DELAY_MS = 3000

export type StartupChoiceResult<Application> = {
  choice: StartupChoice
  application: Application
}

export type StartupChoiceTimer = {
  set(callback: () => void, interval?: number): unknown
  clear(handle: unknown): void
}

export type StartupChoiceDependencies = {
  timer: StartupChoiceTimer
  showStartupSplash(options: { onTouch?: () => void }): unknown
  autoBootDelayMs?: number
}

export function waitForStartupChoice<Application>({
  timer,
  showStartupSplash,
  autoBootDelayMs = STARTUP_AUTO_BOOT_DELAY_MS,
}: StartupChoiceDependencies): Promise<StartupChoiceResult<Application>> {
  return new Promise((resolve) => {
    let isResolved = false
    const handles: { autoBoot?: unknown; settings?: unknown } = {}

    const choose = (choice: StartupChoice, application: Application) => {
      if (isResolved) return
      isResolved = true
      timer.clear(handles.autoBoot)
      timer.clear(handles.settings)
      resolve({ choice, application })
    }

    const application = showStartupSplash({
      onTouch: () => {
        handles.settings = timer.set(() => choose('settings', application), 0)
      },
    }) as Application
    handles.autoBoot = timer.set(() => choose('boot', application), autoBootDelayMs)
  })
}
