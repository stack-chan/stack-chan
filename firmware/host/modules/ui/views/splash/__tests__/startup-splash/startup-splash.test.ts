import { showStartupSplash } from 'startup-splash'
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

equal(title.string, 'Stack-chan', 'splash title should show the product name')
equal(message.string, 'まもなく起動します', 'splash message should show startup progress')

settingsButton.behavior.onTouchBegan(settingsButton, 0, 0, 0)
settingsButton.behavior.onTouchEnded(settingsButton)
equal(touchCount, 1, 'visible settings action should call the provided callback')

trace('ok\n')
