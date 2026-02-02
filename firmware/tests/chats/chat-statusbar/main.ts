import { Application } from 'piu/MC'
import { ChatStatusBar } from 'chat-status-bar'
import { assert, equal } from 'mocks/assert'

trace('=== chat-statusbar test ===\n')

const app = new Application(null, {
  contents: [new ChatStatusBar()],
})

const bar = app.first as unknown as { first?: any; last?: any; behavior?: any }
const label = bar.first as { string: string }
const levelTrack = bar.last as { first?: any; visible?: boolean }
const levelFill = levelTrack.first as { width: number }
const behavior = bar.behavior as {
  onChatState?: (container: unknown, state: string, error?: string) => void
  onChatInputLevel?: (container: unknown, level: number) => void
}

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
