import { showStartupSplash } from 'startup-splash'
import { equal } from 'testing/assert'

trace('=== startup-splash test ===\n')

let touchCount = 0
const application = showStartupSplash({
  onTouch() {
    touchCount += 1
  },
})

const root = application.first as unknown as {
  active: boolean
  first: {
    first: {
      string: string
      next: {
        string: string
      }
    }
  }
  behavior: {
    onTouchBegan: (container: unknown) => void
  }
}
const column = root.first
const title = column.first
const message = title.next

equal(root.active, true, 'splash root should receive touch events')
equal(title.string, 'Stack-chan', 'splash title should show the product name')
equal(message.string, 'Starting...', 'splash message should show startup progress')

root.behavior.onTouchBegan(root)
equal(touchCount, 1, 'splash touch should call the provided callback')

trace('ok\n')
