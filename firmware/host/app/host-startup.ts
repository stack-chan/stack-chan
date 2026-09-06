export type HostStartupOptions<Application> = {
  timer: {
    set(callback: () => void, interval?: number): unknown
    clear(handle: unknown): void
  }
  showSplash(options: { onMods?: () => void; onSettings: () => void }): Application
  openSettings(application: Application): Promise<'back' | 'boot'>
  openMods?: () => void
  autoBootDelayMs?: number
}

/** The host finishes setup or enters maintenance before evaluating an application. */
export async function runHostStartup<Application>(options: HostStartupOptions<Application>): Promise<boolean> {
  for (;;) {
    const result = await new Promise<{ choice: 'boot' | 'mods' | 'settings'; application: Application }>(
      (resolve, reject) => {
        let settled = false
        let pending = false
        let application: Application
        let autoBoot: unknown
        let transition: unknown
        const clear = () => {
          if (autoBoot !== undefined) options.timer.clear(autoBoot)
          if (transition !== undefined) options.timer.clear(transition)
          autoBoot = transition = undefined
        }
        const choose = (choice: 'boot' | 'mods' | 'settings') => {
          if (settled) return
          settled = true
          clear()
          resolve({ choice, application })
        }
        // Leave the Piu touch callback before replacing its Application.
        const defer = (choice: 'mods' | 'settings') => {
          if (settled || pending) return
          pending = true
          try {
            clear()
            transition = options.timer.set(() => choose(choice), 0)
          } catch (error) {
            settled = true
            reject(error)
          }
        }
        try {
          application = options.showSplash({
            onMods: options.openMods ? () => defer('mods') : undefined,
            onSettings: () => defer('settings'),
          })
          autoBoot = options.timer.set(() => choose('boot'), options.autoBootDelayMs ?? 3000)
        } catch (error) {
          settled = true
          clear()
          reject(error)
        }
      },
    )
    if (result.choice === 'boot') return true
    if (result.choice === 'mods') {
      options.openMods?.()
      return false
    }
    if ((await options.openSettings(result.application)) === 'boot') return true
  }
}
