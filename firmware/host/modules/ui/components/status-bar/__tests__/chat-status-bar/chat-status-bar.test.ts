import { type AppBarMode, ChatStatusBar, ChatStatusBarState } from 'chat-status-bar'
import { Application } from 'piu/MC'
import { assert, equal } from 'testing/assert'

trace('=== chat-statusbar test ===\n')

const app = new Application(null, {
  contents: [new ChatStatusBar()],
})

type StatusBarBehavior = {
  onChatState?: (container: unknown, state: number, error?: string) => void
  onChatInputLevel?: (container: unknown, level: number) => void
  onConnectionIndicator?: (container: unknown, visible: boolean) => void
  onFinished?: (container: unknown) => void
  onMenuReveal?: (container: unknown) => void
  onAppBarMode?: (container: unknown, mode: AppBarMode) => void
  onMiniAppAvailability?: (container: unknown, available: boolean) => void
}

type StatusBarContent = {
  content(name: string): unknown
  behavior?: StatusBarBehavior
}

type StatusIcon = {
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

type BarControl = {
  active?: boolean
  visible?: boolean
}

type BarTitle = {
  string?: string
  visible?: boolean
}

type LevelFill = {
  height?: number
  skin?: unknown
}

const bar = app.first as unknown as StatusBarContent
const statusIcon = bar.content('statusIcon') as StatusIcon
const statusIndicator = bar.content('statusIndicator') as StatusIndicator
const levelTrack = bar.content('levelTrack') as LevelTrack
const levelFill = levelTrack.first as LevelFill
const menuButton = bar.content('menuButton') as BarControl
const appsButton = bar.content('appsButton') as BarControl
const backButton = bar.content('backButton') as BarControl
const title = bar.content('title') as BarTitle
const behavior = bar.behavior as StatusBarBehavior

behavior.onMiniAppAvailability?.(bar, true)
assert(appsButton.visible === true, 'apps button should appear when a mini app is registered')
assert(appsButton.active === true, 'visible apps button should accept touches')

behavior.onAppBarMode?.(bar, { kind: 'launcher', title: 'ミニアプリ' })
assert(backButton.visible === true, 'launcher mode should show the host-owned back button')
assert(backButton.active === true, 'launcher back button should accept touches')
assert(appsButton.visible === false, 'launcher mode should hide the apps button')
assert(menuButton.visible === false, 'launcher mode should hide the drawer button')
assert(title.visible === true, 'launcher mode should show a title')
equal(title.string, 'ミニアプリ', 'launcher mode should display its title')

behavior.onAppBarMode?.(bar, { kind: 'face' })
assert(backButton.visible === false, 'face mode should hide the back button')
assert(appsButton.visible === true, 'face mode should restore the apps button')

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

behavior.onConnectionIndicator?.(bar, true)
assert(statusIndicator.visible === true, 'external connection indicator should be visible')
assert(levelTrack.visible === false, 'external connection indicator should take priority over the level track')
assert(statusIcon.visible === false, 'external connection indicator should take priority over the status icon')
behavior.onConnectionIndicator?.(bar, false)
assert(statusIndicator.visible === false, 'external connection indicator should hide when connection is ready')
assert(levelTrack.visible === true, 'level track should return after the external connection is ready')
assert(statusIcon.visible === true, 'status icon should return after the external connection is ready')

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
