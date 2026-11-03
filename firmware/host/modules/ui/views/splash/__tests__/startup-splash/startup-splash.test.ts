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
  message: 'Wi-Fi接続済み: 時刻同期に失敗しました\n192.0.2.123',
  onRetry() {
    retryCount += 1
  },
  onOffline() {
    offlineCount += 1
  },
})
equal(
  message.string,
  'Wi-Fi接続済み: 時刻同期に失敗しました\n192.0.2.123',
  'recovery should retain the time server on its own line',
)

const retryButton = column.next.first
const offlineButton = retryButton.next as typeof retryButton
retryButton.behavior.onTouchBegan(retryButton, 0, 0, 0)
retryButton.behavior.onTouchEnded(retryButton)
offlineButton.behavior.onTouchBegan(offlineButton, 0, 0, 0)
offlineButton.behavior.onTouchEnded(offlineButton)
equal(retryCount, 1, 'recovery view should expose retry as a touch action')
equal(offlineCount, 1, 'recovery view should expose offline boot as a touch action')

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

trace('@@STACKCHAN_TEST:PASS@@\n')
