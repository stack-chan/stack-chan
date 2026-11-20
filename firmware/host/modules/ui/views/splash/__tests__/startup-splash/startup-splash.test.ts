import { localize, setLocalizationLanguage } from 'localization'
import type { Scroller, Text } from 'piu/MC'
import { showStartupSplash, showWiFiConnectionStatus, showWiFiRecoveryChoice } from 'startup-splash'
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
    next: Scroller
  }
  next: {
    y: number
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
const message = title.next.first as Text
const settingsButton = column.next.first

equal(title.string, 'Stack-chan[・＿・]', 'splash title should show the product name')
equal(message.string, 'まもなく起動します', 'splash message should show startup progress')

settingsButton.behavior.onTouchBegan(settingsButton, 0, 0, 0)
settingsButton.behavior.onTouchEnded(settingsButton)
equal(touchCount, 1, 'visible settings action should call the provided callback')

let retryCount = 0
let offlineCount = 0
showWiFiRecoveryChoice({
  message: 'Wi-Fi接続済み: 時刻同期に失敗しました',
  sntpHost: '192.0.2.123',
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

const wideLabel = 'W'.repeat(63)
const longHost = [wideLabel, wideLabel, wideLabel, 'W'.repeat(61)].join('.')
for (const [locale, expectedMessage] of [
  ['ja', 'Wi-Fi接続済み: 時刻同期に失敗しました'],
  ['en', 'Wi-Fi connected; time sync failed'],
  ['zh-CN', 'Wi-Fi已连接: 时间同步失败'],
] as const) {
  setLocalizationLanguage(locale)
  const localizedApplication = showStartupSplash()
  const localizedColumn = localizedApplication.first as unknown as typeof column
  const viewport = localizedColumn.first.next
  const text = viewport.first as Text
  const style = text.style
  const status = localize('boot.timeSyncFailed')
  equal(status, expectedMessage, `${locale}: time-sync message`)
  for (const address of ['Time-Server01.example.', '192.0.2.123', '[fe80::ABCD%eth0]']) {
    showWiFiRecoveryChoice({ message: status, sntpHost: address })
    equal(text.string, `${status}\n${address}`, `${locale}: short address stays on one line`)
  }
  for (const character of '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-.:_%[]') {
    equal((style?.measure(character).width ?? 0) > 0, true, `${locale}: missing bitmap glyph ${character}`)
  }

  showWiFiRecoveryChoice({ message: status, sntpHost: longHost })
  const [summary, ...lines] = text.string.split('\n')
  equal(summary, expectedMessage, `${locale}: preserve the localized error`)
  equal(lines.length > 1, true, `${locale}: wrap a maximum-length hostname`)
  equal(lines.join(''), longHost, `${locale}: preserve every hostname character in order`)
  for (const line of lines) {
    equal((style?.measure(line).width ?? Infinity) <= viewport.width, true, `${locale}: each line fits the viewport`)
  }
  equal(text.height > 0 && text.height <= viewport.height, true, `${locale}: the longest DNS name fits without touch`)
  equal(viewport.y + viewport.height <= localizedColumn.next.y, true, `${locale}: keep recovery actions clear`)

  showWiFiRecoveryChoice({ message: status, sntpHost: longHost.repeat(5) })
  const overflow = text.height - viewport.height
  equal(overflow > 0, true, `${locale}: an oversized value exercises scrolling`)
  const drag = viewport.behavior as {
    onTouchBegan: (scroller: Scroller, id: number, x: number, y: number) => void
    onTouchMoved: (scroller: Scroller, id: number, x: number, y: number) => void
  }
  drag.onTouchBegan(viewport, 0, 0, 0)
  drag.onTouchMoved(viewport, 0, 0, -text.height)
  equal(text.y + text.height, viewport.y + viewport.height, `${locale}: scrolling reveals the bottom of the text`)
  equal(viewport.scroll.y, overflow, `${locale}: the final line is reachable`)
  showWiFiConnectionStatus({ attempt: 1, maxAttempts: 3 })
  equal(viewport.scroll.y, 0, `${locale}: retry returns the message to the top`)
  equal(text.string, localize('splash.connecting', { attempt: 1, maxAttempts: 3 }), `${locale}: retry status`)
}

trace('@@STACKCHAN_TEST:PASS@@\n')
