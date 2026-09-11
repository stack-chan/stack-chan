import { showStartupFailure, showStartupSplash } from 'startup-splash'
import { equal } from 'testing/assert'

trace('=== startup-splash test ===\n')

let touchCount = 0
const application = showStartupSplash({
  onSettings() {
    touchCount += 1
  },
})

const column = application.first as unknown as {
  first: {
    string: string
    next: {
      string: string
    }
  }
  next: {
    first: {
      next?: {
        behavior: {
          onTouchBegan: (container: unknown, id: number, x: number, y: number) => void
          onTouchEnded: (container: unknown) => void
        }
      }
      behavior: {
        onTouchBegan: (container: unknown, id: number, x: number, y: number) => void
        onTouchEnded: (container: unknown) => void
      }
    }
  }
}
const title = column.first
const message = title.next
const settingsButton = column.next.first

equal(title.string, 'Stack-chan[・＿・]', 'splash title should show the product name')
equal(message.string, 'まもなく起動します', 'splash message should show startup progress')

settingsButton.behavior.onTouchBegan(settingsButton, 0, 0, 0)
settingsButton.behavior.onTouchEnded(settingsButton)
equal(touchCount, 1, 'visible settings action should call the provided callback')

let modsCount = 0
const selectionApplication = showStartupSplash({
  onMods() {
    modsCount += 1
  },
})
const selectionColumn = selectionApplication.first as unknown as typeof column
const modsButton = selectionColumn.next.first
modsButton.behavior.onTouchBegan(modsButton, 0, 0, 0)
modsButton.behavior.onTouchEnded(modsButton)
equal(modsCount, 1, 'startup view should expose the MOD manager as a touch action')

let restarts = 0
const failure = showStartupFailure({
  message: 'Failed',
  detail: 'Rebuild this MOD',
  onRestart: () => {
    restarts++
  },
})
const failureColumn = failure.first as unknown as typeof column
const restart = failureColumn.next.first
restart.behavior.onTouchBegan(restart, 0, 0, 0)
restart.behavior.onTouchEnded(restart)
equal(restarts, 1, 'failure view retains its restart action')
equal(failureColumn.first.next.string, 'Failed', 'failure view describes startup failure')

trace('ok\n')
