import { ChatStatusBar, ChatStatusBarState } from 'chat-status-bar'
import { Application } from 'piu/MC'
import { assert, equal } from 'testing/assert'

trace('=== chat-statusbar test ===\n')

const app = new Application(null, {
  contents: [new ChatStatusBar()],
})

type StatusBarBehavior = {
  onChatState?: (container: unknown, state: number, error?: string) => void
  onChatInputLevel?: (container: unknown, level: number) => void
}

type StatusBarContent = {
  first?: StatusIcon
  last?: LevelTrack
  behavior?: StatusBarBehavior
}

type StatusIcon = {
  next?: StatusIndicator
  visible?: boolean
  state?: number
}

type StatusIndicator = {
  visible?: boolean
}

type LevelTrack = {
  first?: LevelFill
  visible?: boolean
}

type LevelFill = {
  height?: number
  skin?: unknown
}

const bar = app.first as unknown as StatusBarContent
const statusIcon = bar.first as StatusIcon
const statusIndicator = statusIcon.next as StatusIndicator
const levelTrack = bar.last as LevelTrack
const levelFill = levelTrack.first as LevelFill
const behavior = bar.behavior as StatusBarBehavior

behavior.onChatState?.(bar, ChatStatusBarState.CONNECTING)
assert(statusIndicator.visible === true, 'connecting indicator should be visible')
assert(statusIcon.visible === false, 'status icon should be hidden while connecting')

behavior.onChatState?.(bar, ChatStatusBarState.SPEAKING)
assert(levelTrack.visible === true, 'level track should be visible in SPEAKING')
assert(statusIcon.visible === true, 'status icon should be visible in SPEAKING')
equal(statusIcon.state, 0, 'SPEAKING should use microphone input icon state')

behavior.onChatInputLevel?.(bar, 1000)
equal(levelFill.height, 8, 'half input level should fill half the track')

behavior.onChatState?.(bar, ChatStatusBarState.LISTENING)
assert(levelTrack.visible === false, 'level track should be hidden in LISTENING')
assert(statusIcon.visible === true, 'status icon should be visible in LISTENING')
equal(statusIcon.state, 1, 'LISTENING should use output icon state')

const normalFillSkin = levelFill.skin
behavior.onChatState?.(bar, ChatStatusBarState.FAILED, 'boom')
assert(levelTrack.visible === false, 'level track should be hidden after failure')
assert(statusIcon.visible === false, 'status icon should be hidden after failure')
assert(statusIndicator.visible === false, 'connecting indicator should be hidden after failure')
assert(levelFill.skin !== normalFillSkin, 'failed state should switch level fill to error skin')

trace('ok\n')
