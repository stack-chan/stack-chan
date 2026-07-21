import { showStartupSplash, showWiFiRecoveryChoice } from 'startup-splash'
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

let retryCount = 0
let offlineCount = 0
showWiFiRecoveryChoice({
  message: '接続失敗',
  onRetry() {
    retryCount += 1
  },
  onOffline() {
    offlineCount += 1
  },
})

const retryButton = column.next.first
const offlineButton = retryButton.next as typeof retryButton
retryButton.behavior.onTouchBegan(retryButton, 0, 0, 0)
retryButton.behavior.onTouchEnded(retryButton)
offlineButton.behavior.onTouchBegan(offlineButton, 0, 0, 0)
offlineButton.behavior.onTouchEnded(offlineButton)
equal(retryCount, 1, 'recovery view should expose retry as a touch action')
equal(offlineCount, 1, 'recovery view should expose offline boot as a touch action')

trace('ok\n')
