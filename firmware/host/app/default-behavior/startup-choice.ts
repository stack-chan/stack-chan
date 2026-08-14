export type StartupChoice = 'boot' | 'mods' | 'settings'

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
  showStartupSplash(options: { onMods?: () => void; onSettings?: () => void }): unknown
  autoBootDelayMs?: number
  enableMods?: boolean
}

export function waitForStartupChoice<Application>({
  timer,
  showStartupSplash,
  autoBootDelayMs = STARTUP_AUTO_BOOT_DELAY_MS,
  enableMods = false,
}: StartupChoiceDependencies): Promise<StartupChoiceResult<Application>> {
  return new Promise((resolve) => {
    let isResolved = false
    const handles: { autoBoot?: unknown; mods?: unknown; settings?: unknown } = {}
    const clearTimer = (handle: unknown | undefined) => {
      if (handle !== undefined) {
        timer.clear(handle)
      }
    }

    const choose = (choice: StartupChoice, application: Application) => {
      if (isResolved) return
      isResolved = true
      clearTimer(handles.autoBoot)
      clearTimer(handles.mods)
      clearTimer(handles.settings)
      resolve({ choice, application })
    }

    const application = showStartupSplash({
      onMods: enableMods
        ? () => {
            handles.mods = timer.set(() => choose('mods', application), 0)
          }
        : undefined,
      onSettings: () => {
        handles.settings = timer.set(() => choose('settings', application), 0)
      },
    }) as Application
    handles.autoBoot = timer.set(() => choose('boot', application), autoBootDelayMs)
  })
}
