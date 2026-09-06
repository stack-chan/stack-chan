import type { CancellationSignal } from 'stackchan/task'

type Choice = 'retry' | 'offline'
export type RecoveryButton = { onChanged: (this: RecoveryButton) => void }
type Presenter = (options: { message: string; onRetry(): void; onOffline(): void }) => () => void

/** Own only the handlers and view installed by this request. */
export function requestBootRecoveryChoice(
  message: string,
  signal: CancellationSignal,
  present: Presenter,
  buttons: { a?: RecoveryButton; c?: RecoveryButton },
): Promise<Choice> {
  return new Promise((resolve, reject) => {
    let settled = false
    let releaseView: (() => void) | undefined
    let unsubscribe: (() => void) | undefined
    const restoreButtons: (() => void)[] = []
    const finish = (result: { choice: Choice } | { error: unknown }) => {
      if (settled) return
      settled = true
      let failure: unknown
      let failed = false
      for (const close of [() => unsubscribe?.(), ...restoreButtons, () => releaseView?.()]) {
        try {
          close()
        } catch (error) {
          if (!failed) {
            failed = true
            failure = error
          }
        }
      }
      if ('error' in result) reject(result.error)
      else if (failed) reject(failure)
      else resolve(result.choice)
    }
    const choose = (choice: Choice) => finish({ choice })
    const install = (button: RecoveryButton | undefined, choice: Choice) => {
      if (!button) return
      const previous = button.onChanged
      const handler = () => choose(choice)
      button.onChanged = handler
      restoreButtons.push(() => {
        if (button.onChanged === handler) button.onChanged = previous
      })
    }
    unsubscribe = signal.subscribe((error) => finish({ error }))
    if (settled) {
      unsubscribe()
      return
    }
    try {
      install(buttons.a, 'retry')
      install(buttons.c, 'offline')
      const release = present({ message, onRetry: () => choose('retry'), onOffline: () => choose('offline') })
      if (settled) release()
      else releaseView = release
    } catch (error) {
      finish({ error })
    }
  })
}
