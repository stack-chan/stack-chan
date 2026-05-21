import { ChatStatusBar } from 'chat-status-bar'
import { assert, equal } from 'mocks/assert'
import { Application } from 'piu/MC'

trace('=== chat-statusbar test ===\n')

const app = new Application(null, {
  contents: [new ChatStatusBar()],
})

type StatusBarBehavior = {
  onChatState?: (container: unknown, state: string, error?: string) => void
  onChatInputLevel?: (container: unknown, level: number) => void
}

type StatusBarContent = {
  first?: { string?: string }
  last?: { first?: { width?: number }; visible?: boolean }
  behavior?: StatusBarBehavior
}

const bar = app.first as unknown as StatusBarContent
const label = bar.first as { string: string }
const levelTrack = bar.last as { first?: { width?: number }; visible?: boolean }
const levelFill = levelTrack.first as { width: number }
const behavior = bar.behavior as StatusBarBehavior

behavior.onChatState?.(bar, 'CONNECTING')
equal(label.string, 'connecting', 'connecting label')

behavior.onChatState?.(bar, 'SPEAKING')
equal(label.string, 'speaking', 'speaking label')
assert(levelTrack.visible === true, 'level track should be visible in SPEAKING')

behavior.onChatInputLevel?.(bar, 1000)
assert(levelFill.width > 0, 'level fill should grow')

behavior.onChatState?.(bar, 'FAILED', 'boom')
assert(label.string.indexOf('error') === 0, 'failed label')

trace('ok\n')
