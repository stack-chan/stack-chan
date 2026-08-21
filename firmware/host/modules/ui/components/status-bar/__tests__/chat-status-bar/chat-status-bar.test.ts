import {
  type AppBarMode,
  batteryLevelToSegments,
  ChatStatusBar,
  ChatStatusBarState,
  formatAppBarTime,
} from 'chat-status-bar'
import { Application } from 'piu/MC'
import { assert, equal } from 'testing/assert'
import { uiStyles } from 'ui-theme'

trace('=== chat-statusbar test ===\n')

function dateAt(hours: number, minutes: number): Date {
  return {
    getTime: () => 1_704_099_900_000,
    getHours: () => hours,
    getMinutes: () => minutes,
  } as Date
}

let currentDate = dateAt(9, 5)
let batteryLevel: number | undefined = 75
const app = new Application(null, {
  contents: [
    new ChatStatusBar({
      now: () => currentDate,
      readBatteryLevel: () => batteryLevel,
    }),
  ],
})

type StatusBarBehavior = {
  onChatState?: (container: unknown, state: number, error?: string) => void
  onChatInputLevel?: (container: unknown, level: number) => void
  onConnectionIndicator?: (container: unknown, visible: boolean) => void
  onFinished?: (container: unknown) => void
  onUndisplaying?: (container: unknown) => void
  onAppBarReveal?: (container: unknown) => void
  onAppBarMode?: (container: unknown, mode: AppBarMode) => void
  onMiniAppAvailability?: (container: unknown, available: boolean) => void
}

type StatusBarContent = {
  content(name: string): unknown
  behavior?: StatusBarBehavior
  skin?: unknown
  visible?: boolean
}

type StatusIcon = {
  x?: number
  visible?: boolean
  state?: number
}

type StatusIndicator = {
  active?: boolean
  visible?: boolean
  x?: number
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

type ClockLabel = {
  behavior?: {
    onDisplaying?: (label: unknown) => void
    onTimeChanged?: (label: unknown) => void
  }
  running?: boolean
  style?: {
    measure: (string: string) => { height: number; width: number }
  }
  string?: string
  visible?: boolean
  width?: number
}

type BatteryPort = {
  active?: boolean
  behavior?: {
    onDraw?: (port: unknown) => void
    onDisplaying?: (port: unknown) => void
    onTimeChanged?: (port: unknown) => void
  }
  height?: number
  running?: boolean
  visible?: boolean
  width?: number
  x?: number
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
const clock = bar.content('clock') as ClockLabel
const battery = bar.content('battery') as BatteryPort
const behavior = bar.behavior as StatusBarBehavior
const faceChromeSkin = bar.skin

clock.behavior?.onDisplaying?.(clock)
battery.behavior?.onDisplaying?.(battery)
equal(clock.string, '09:05', 'face mode should show local time in the center')
assert(clock.visible === true, 'face mode should keep the clock visible')
assert(battery.visible === true, 'a valid battery reading should show the battery icon')
assert(clock.running === true, 'face mode should run the clock timer')
assert(battery.running === true, 'face mode should run the battery timer')
assert(battery.active === false, 'battery status should never intercept touches')
const baseTimeSize = uiStyles().button.measure('09:05')
const appBarTimeSize = clock.style?.measure('09:05')
assert((baseTimeSize.width ?? 0) > 0, 'base time width should be measurable')
assert((baseTimeSize.height ?? 0) > 0, 'base time height should be measurable')
equal(appBarTimeSize?.width, (baseTimeSize.width ?? 0) * 2, 'AppBar time should render at twice the base width')
equal(appBarTimeSize?.height, (baseTimeSize.height ?? 0) * 2, 'AppBar time should render at twice the base height')
equal(battery.width, 48, 'battery status should use a double-width drawing surface')
equal(battery.height, 32, 'battery status should use a double-height drawing surface')
const batteryDrawBounds = { width: 0, height: 0 }
battery.behavior?.onDraw?.({
  fillColor(_color: unknown, x: number, y: number, width: number, height: number) {
    batteryDrawBounds.width = Math.max(batteryDrawBounds.width, x + width)
    batteryDrawBounds.height = Math.max(batteryDrawBounds.height, y + height)
  },
})
assert(batteryDrawBounds.width > (battery.width ?? 0) * 0.9, 'battery drawing should fill the double-width surface')
assert(batteryDrawBounds.height > (battery.height ?? 0) * 0.8, 'battery drawing should fill the double-height surface')
equal(statusIcon.x, 8, 'persistent microphone status should use the natural top-left position')
assert(
  (statusIndicator.x ?? 0) > (battery.x ?? 0) + (battery.width ?? 0),
  'transient connection status should remain beside the AppBar battery',
)
equal(formatAppBarTime(new Date(0)), '--:--', 'unset system time should use a placeholder')
equal(batteryLevelToSegments(0), 0, 'empty battery should draw no cells')
equal(batteryLevelToSegments(25), 1, 'quarter battery should draw one cell')
equal(batteryLevelToSegments(50), 2, 'half battery should draw two cells')
equal(batteryLevelToSegments(75), 3, 'three-quarter battery should draw three cells')
equal(batteryLevelToSegments(100), 4, 'full battery should draw four cells')

currentDate = dateAt(10, 6)
clock.behavior?.onTimeChanged?.(clock)
equal(clock.string, '10:06', 'clock timer should update after the minute changes')

behavior.onMiniAppAvailability?.(bar, true)
assert(appsButton.visible === true, 'apps button should appear when a mini app is registered')
assert(appsButton.active === true, 'visible apps button should accept touches')

behavior.onAppBarMode?.(bar, { kind: 'launcher', title: 'ミニアプリ' })
assert(bar.visible === true, 'launcher mode should keep the AppBar visible')
assert(backButton.visible === true, 'launcher mode should show the host-owned back button')
assert(backButton.active === true, 'launcher back button should accept touches')
assert(app.hit(16, 22) === backButton, 'non-interactive status content must not intercept the Back button')
assert(appsButton.visible === false, 'launcher mode should hide the apps button')
assert(menuButton.visible === false, 'launcher mode should hide the drawer button')
assert(title.visible === true, 'launcher mode should show a title')
equal(title.string, 'ミニアプリ', 'launcher mode should display its title')
assert(clock.visible === false, 'launcher mode should hide the face clock')
assert(battery.visible === false, 'launcher mode should hide battery status')
assert(clock.running === false, 'launcher mode should stop the hidden clock timer')
assert(battery.running === false, 'launcher mode should stop the hidden battery timer')

behavior.onAppBarMode?.(bar, { kind: 'face' })
assert(bar.visible === true, 'returning to face mode should reveal the AppBar')
assert(backButton.visible === false, 'face mode should hide the back button')
assert(appsButton.visible === true, 'face mode should restore the apps button')
assert(clock.visible === true, 'returning to face mode should restore the clock')
assert(battery.visible === true, 'returning to face mode should restore valid battery status')
assert(clock.running === true, 'returning to face mode should restart the clock timer')
assert(battery.running === true, 'returning to face mode should restart the battery timer')

batteryLevel = undefined
battery.behavior?.onTimeChanged?.(battery)
assert(battery.visible === false, 'unavailable battery readings should hide the icon')
batteryLevel = 25
battery.behavior?.onTimeChanged?.(battery)
assert(battery.visible === true, 'battery status should recover after a later valid reading')

behavior.onFinished?.(bar)
assert(bar.visible === false, 'the reveal timer should hide the entire AppBar')
assert(bar.skin !== faceChromeSkin, 'hidden face chrome should restore the transparent status layer')
assert(menuButton.visible === false, 'menu button should hide with the AppBar')
assert(menuButton.active === false, 'hidden menu button should not intercept touches')
assert(appsButton.visible === false, 'apps button should hide with the menu button')
assert(appsButton.active === false, 'hidden apps button should not intercept touches')
assert(clock.visible === false, 'clock should hide with the AppBar')
assert(battery.visible === false, 'battery status should hide with the AppBar')
assert(clock.running === false, 'hidden AppBar should stop the clock timer')
assert(battery.running === false, 'hidden AppBar should stop the battery timer')
behavior.onMiniAppAvailability?.(bar, false)
behavior.onMiniAppAvailability?.(bar, true)
assert(appsButton.visible === false, 'availability changes should not bypass the hidden AppBar state')
behavior.onAppBarReveal?.(bar)
assert(bar.visible === true, 'an explicit reveal should restore the entire AppBar')
assert(bar.skin === faceChromeSkin, 'the visible face AppBar should use an opaque background')
assert(menuButton.visible === true, 'menu button should be revealed again on request')
assert(menuButton.active === true, 'revealed menu button should accept touches')
assert(appsButton.visible === true, 'apps button should be revealed with the menu button')
assert(appsButton.active === true, 'revealed apps button should accept touches')
assert(clock.visible === true, 'revealing the AppBar should restore the clock')
assert(battery.visible === true, 'revealing the AppBar should restore battery status')
assert(clock.running === true, 'revealing the AppBar should restart the clock timer')
assert(battery.running === true, 'revealing the AppBar should restart the battery timer')

behavior.onChatState?.(bar, ChatStatusBarState.CONNECTING)
assert(statusIndicator.visible === true, 'connecting indicator should be visible')
assert(statusIndicator.active === false, 'connecting indicator should never intercept touches')
assert(statusIcon.visible === false, 'status icon should be hidden while connecting')

behavior.onChatState?.(bar, ChatStatusBarState.SPEAKING)
assert(levelTrack.visible === false, 'visible AppBar should hide the input level beside its battery')
assert(statusIcon.visible === false, 'visible AppBar should hide the microphone beside its battery')

behavior.onFinished?.(bar)
assert(bar.visible === true, 'user input should keep the microphone area visible after the AppBar timeout')
assert(bar.skin !== faceChromeSkin, 'persistent microphone status should not retain the AppBar background')
assert(menuButton.visible === false, 'persistent microphone status should not keep face actions visible')
assert(clock.visible === false, 'persistent microphone status should not keep the clock visible')
assert(battery.visible === false, 'persistent microphone status should not keep battery status visible')
assert(levelTrack.visible === true, 'input level should remain visible after the AppBar timeout')
assert(statusIcon.visible === true, 'microphone icon should remain visible after the AppBar timeout')
behavior.onChatState?.(bar, ChatStatusBarState.WAITING)
assert(bar.visible === false, 'leaving user input should hide a previously timed-out AppBar')
behavior.onAppBarReveal?.(bar)
behavior.onChatState?.(bar, ChatStatusBarState.SPEAKING)

behavior.onConnectionIndicator?.(bar, true)
assert(statusIndicator.visible === true, 'external connection indicator should be visible')
assert(levelTrack.visible === false, 'external connection indicator should take priority over the level track')
assert(statusIcon.visible === false, 'external connection indicator should take priority over the status icon')
behavior.onConnectionIndicator?.(bar, false)
assert(statusIndicator.visible === false, 'external connection indicator should hide when connection is ready')
assert(levelTrack.visible === false, 'visible AppBar should keep the level track hidden after connection')
assert(statusIcon.visible === false, 'visible AppBar should keep the microphone hidden after connection')

behavior.onChatInputLevel?.(bar, 1000)
equal(levelFill.height, 8, 'half input level should fill half the track')

behavior.onChatState?.(bar, ChatStatusBarState.LISTENING)
assert(levelTrack.visible === false, 'level track should be hidden while user is listening')
assert(statusIcon.visible === false, 'visible AppBar should not add chat status beside its battery')

const normalFillSkin = levelFill.skin
behavior.onChatState?.(bar, ChatStatusBarState.FAILED, 'boom')
assert(levelTrack.visible === false, 'level track should be hidden after failure')
assert(statusIcon.visible === false, 'status icon should be hidden after failure')
assert(statusIndicator.visible === false, 'connecting indicator should be hidden after failure')
assert(levelFill.skin !== normalFillSkin, 'failed state should switch level fill to error skin')

behavior.onUndisplaying?.(bar)
assert(clock.running === false, 'teardown should stop the clock timer')
assert(battery.running === false, 'teardown should stop the battery timer')

trace('ok\n')
