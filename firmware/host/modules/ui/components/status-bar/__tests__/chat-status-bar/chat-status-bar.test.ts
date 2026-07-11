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
  onFinished?: (container: unknown) => void
  onMenuReveal?: (container: unknown) => void
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
  next?: LevelTrack
  visible?: boolean
}

type LevelTrack = {
  first?: LevelFill
  next?: MenuButton
  visible?: boolean
}

type MenuButton = {
  active?: boolean
  visible?: boolean
}

type LevelFill = {
  height?: number
  skin?: unknown
}

const bar = app.first as unknown as StatusBarContent
const statusIcon = bar.first as StatusIcon
const statusIndicator = statusIcon.next as StatusIndicator
const levelTrack = statusIndicator.next as LevelTrack
const levelFill = levelTrack.first as LevelFill
const menuButton = levelTrack.next as MenuButton
const behavior = bar.behavior as StatusBarBehavior

behavior.onFinished?.(bar)
assert(menuButton.visible === false, 'menu button should hide when its reveal timer finishes')
assert(menuButton.active === false, 'hidden menu button should not intercept touches')
behavior.onMenuReveal?.(bar)
assert(menuButton.visible === true, 'menu button should be revealed again on request')
assert(menuButton.active === true, 'revealed menu button should accept touches')

behavior.onChatState?.(bar, ChatStatusBarState.CONNECTING)
assert(statusIndicator.visible === true, 'connecting indicator should be visible')
assert(statusIcon.visible === false, 'status icon should be hidden while connecting')

behavior.onChatState?.(bar, ChatStatusBarState.SPEAKING)
assert(levelTrack.visible === true, 'level track should be visible while user is speaking')
assert(statusIcon.visible === true, 'status icon should be visible while user is speaking')
equal(statusIcon.state, 0, 'user speaking should use microphone input icon state')

behavior.onChatInputLevel?.(bar, 1000)
equal(levelFill.height, 8, 'half input level should fill half the track')

behavior.onChatState?.(bar, ChatStatusBarState.LISTENING)
assert(levelTrack.visible === false, 'level track should be hidden while user is listening')
assert(statusIcon.visible === true, 'status icon should be visible while user is listening')
equal(statusIcon.state, 1, 'user listening should use output icon state')

const normalFillSkin = levelFill.skin
behavior.onChatState?.(bar, ChatStatusBarState.FAILED, 'boom')
assert(levelTrack.visible === false, 'level track should be hidden after failure')
assert(statusIcon.visible === false, 'status icon should be hidden after failure')
assert(statusIndicator.visible === false, 'connecting indicator should be hidden after failure')
assert(levelFill.skin !== normalFillSkin, 'failed state should switch level fill to error skin')

trace('ok\n')
