import {
  type AppBarMode,
  batteryLevelToSegments,
  ChatStatusBar,
  ChatStatusBarState,
  formatAppBarTime,
} from 'chat-status-bar'
import { Application } from 'piu/MC'
import { assert, equal } from 'testing/assert'

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
}

type StatusIcon = {
  x?: number
  visible?: boolean
  state?: number
}

type StatusIndicator = {
  active?: boolean
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

type ClockLabel = {
  behavior?: {
    onDisplaying?: (label: unknown) => void
    onTimeChanged?: (label: unknown) => void
  }
  running?: boolean
  string?: string
  visible?: boolean
}

type BatteryPort = {
  active?: boolean
  behavior?: {
    onDisplaying?: (port: unknown) => void
    onTimeChanged?: (port: unknown) => void
  }
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

clock.behavior?.onDisplaying?.(clock)
battery.behavior?.onDisplaying?.(battery)
equal(clock.string, '09:05', 'face mode should show local time in the center')
assert(clock.visible === true, 'face mode should keep the clock visible')
assert(battery.visible === true, 'a valid battery reading should show the battery icon')
assert(clock.running === true, 'face mode should run the clock timer')
assert(battery.running === true, 'face mode should run the battery timer')
assert(battery.active === false, 'battery status should never intercept touches')
assert((statusIcon.x ?? 0) > (battery.x ?? 0) + (battery.width ?? 0), 'chat status should move right of battery')
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
assert(menuButton.visible === false, 'menu button should hide when its reveal timer finishes')
assert(menuButton.active === false, 'hidden menu button should not intercept touches')
assert(appsButton.visible === false, 'apps button should hide with the menu button')
assert(appsButton.active === false, 'hidden apps button should not intercept touches')
assert(clock.running === true, 'the face-action reveal timer should not stop the clock timer')
assert(battery.running === true, 'the face-action reveal timer should not stop the battery timer')
behavior.onMiniAppAvailability?.(bar, false)
behavior.onMiniAppAvailability?.(bar, true)
assert(appsButton.visible === false, 'availability changes should not bypass the hidden AppBar state')
behavior.onAppBarReveal?.(bar)
assert(menuButton.visible === true, 'menu button should be revealed again on request')
assert(menuButton.active === true, 'revealed menu button should accept touches')
assert(appsButton.visible === true, 'apps button should be revealed with the menu button')
assert(appsButton.active === true, 'revealed apps button should accept touches')

behavior.onChatState?.(bar, ChatStatusBarState.CONNECTING)
assert(statusIndicator.visible === true, 'connecting indicator should be visible')
assert(statusIndicator.active === false, 'connecting indicator should never intercept touches')
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

behavior.onUndisplaying?.(bar)
assert(clock.running === false, 'teardown should stop the clock timer')
assert(battery.running === false, 'teardown should stop the battery timer')

trace('ok\n')
