import { AppController } from 'app-controller'
import { ChatStatusBar } from 'chat-status-bar'
import type { MiniAppContext } from 'mini-app'
import { Application, Container, type Container as PiuContainer } from 'piu/MC'
import { assert, equal } from 'testing/assert'

trace('=== mini-app lifecycle test ===\n')

type PositionedContainer = PiuContainer & {
  coordinates?: { top?: number }
  top?: number
}

type TestAppBar = PiuContainer & {
  content(name: string): PiuContainer
}

type ViewBehavior = {
  main?: PiuContainer
  faceMain?: PiuContainer
  appBar?: TestAppBar
}

function topOf(content: PiuContainer): number {
  const positioned = content as PositionedContainer
  return positioned.coordinates?.top ?? positioned.top ?? 0
}

const application = new Application(
  {
    face: new Container(null, { left: 60, top: 60, width: 200, height: 120 }),
    appBar: new ChatStatusBar(),
  },
  { displayListLength: 4096, contents: [], Behavior: AppController },
)
const controller = application.behavior as AppController
const view = application.first as PiuContainer
const viewBehavior = view.behavior as ViewBehavior
const appBar = viewBehavior.appBar as TestAppBar
const appsButton = appBar.content('appsButton') as PiuContainer
const backButton = appBar.content('backButton') as PiuContainer
const title = appBar.content('title') as unknown as { string?: string }

let receivedContext: MiniAppContext | null = null
let behaviorDisposals = 0
let instanceDisposals = 0
const unregister = controller.miniApps.register({
  id: 'test.lifecycle',
  title: 'Lifecycle',
  create(context) {
    receivedContext = context
    const content = new Container(null, {
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
      Behavior: class extends Behavior {
        onDispose() {
          behaviorDisposals += 1
        }
      },
    })
    return {
      content,
      dispose() {
        assert(this.content === content, 'dispose should retain the MiniAppInstance receiver')
        instanceDisposals += 1
      },
    }
  },
})

assert(appsButton.visible === true, 'registering the first app should reveal the apps button')
assert(appsButton.active === true, 'registered-app button should accept touches')

controller.showMiniAppLauncher()
assert(viewBehavior.main !== viewBehavior.faceMain, 'launcher should replace the face main content')
equal(topOf(viewBehavior.main as PiuContainer), 44, 'launcher viewport should begin below the AppBar')
assert(backButton.visible === true, 'launcher should show the host-owned back button')
equal(title.string, 'ミニアプリ', 'launcher should set the AppBar title')

assert(controller.launchMiniApp('test.lifecycle'), 'registered mini app should launch')
assert(receivedContext, 'mini app factory should receive its context')
const context = receivedContext as unknown as MiniAppContext
equal(context.width, 320, 'mini app context should expose the screen width')
equal(context.height, 196, 'mini app context should exclude the 44px AppBar')
assert(Object.isFrozen(context), 'mini app context should be immutable')
equal(topOf(viewBehavior.main as PiuContainer), 44, 'mini app viewport should remain below the AppBar')
equal(title.string, 'Lifecycle', 'running mini app should set its title')

controller.onMiniAppBack()
equal(viewBehavior.main, viewBehavior.faceMain, 'back should restore the preserved face main content')
equal(behaviorDisposals, 1, 'back should invoke content onDispose exactly once')
equal(instanceDisposals, 1, 'back should invoke instance dispose exactly once')
assert(backButton.visible === false, 'face mode should hide the back button')

controller.showMiniAppLauncher()
assert(controller.launchMiniApp('test.lifecycle'), 'mini app should be recreated after it was destroyed')
unregister()
equal(viewBehavior.main, viewBehavior.faceMain, 'unregistering an active app should return to the face')
equal(behaviorDisposals, 2, 'active unregister should dispose content')
equal(instanceDisposals, 2, 'active unregister should dispose instance resources')
assert(appsButton.visible === false, 'unregistering the last app should hide the apps button')

controller.miniApps.register({ id: 'test.other', title: 'Other', create: () => new Container() })
controller.showMiniAppLauncher()
assert(!controller.launchMiniApp('missing'), 'unknown mini app ids should be rejected')
assert(viewBehavior.main !== viewBehavior.faceMain, 'an unknown id should leave the launcher visible')
equal(title.string, 'ミニアプリ', 'an unknown id should preserve the launcher AppBar')

trace('ok\n')
