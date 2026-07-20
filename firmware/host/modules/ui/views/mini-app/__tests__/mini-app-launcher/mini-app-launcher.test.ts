import { createMiniAppViewport, MiniAppLauncher } from 'mini-app-launcher'
import { Application, type Container as PiuContainer } from 'piu/MC'
import { assert, equal } from 'testing/assert'

trace('=== mini-app launcher view test ===\n')

type PositionedContainer = PiuContainer & {
  coordinates?: { top?: number }
  top?: number
}

type ActionBehavior = {
  onTouchBegan?: (container: PiuContainer, id: number, x: number, y: number) => void
  onTouchEnded?: (container: PiuContainer, id: number, x: number, y: number) => void
}

let launched = ''
const launcher = new MiniAppLauncher({
  apps: [{ id: 'test.app', title: 'Test App', icon: 'play' }],
  onLaunch(id) {
    launched = id
  },
})
const viewport = createMiniAppViewport(launcher)
new Application(null, { contents: [viewport] })

const positioned = viewport as PositionedContainer
equal(positioned.coordinates?.top ?? positioned.top, 44, 'launcher viewport should reserve the AppBar height')

const scroller = launcher.first as PiuContainer
assert(scroller.active === true, 'launcher scroller should accept touch input')
const column = scroller.first as PiuContainer
const button = column.first as PiuContainer
assert(button, 'launcher should create one named action for each registered app')
const behavior = button.behavior as ActionBehavior
behavior.onTouchBegan?.(button, 0, 10, 10)
behavior.onTouchEnded?.(button, 0, 10, 10)
equal(launched, 'test.app', 'launcher action should request the selected app id')

trace('ok\n')
