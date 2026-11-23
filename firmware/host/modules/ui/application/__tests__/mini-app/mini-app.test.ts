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
  drawerOpen?: boolean
}

type TestAppBarBehavior = {
  onFinished?: (container: PiuContainer) => void
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
const appBarBehavior = appBar.behavior as TestAppBarBehavior
const appsButton = appBar.content('appsButton') as PiuContainer
const menuButton = appBar.content('menuButton') as PiuContainer
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

appBarBehavior.onFinished?.(appBar)
assert(appBar.visible === false, 'AppBar timer should hide the entire AppBar')
assert(menuButton.visible === false, 'AppBar timer should hide the drawer button')
assert(appsButton.visible === false, 'AppBar timer should hide the apps button at the same time')
controller.onFaceTouch()
assert(viewBehavior.drawerOpen === false, 'face touch should reveal AppBar actions without opening the drawer')
assert(appBar.visible === true, 'face touch should reveal the entire AppBar')
assert(menuButton.visible === true, 'face touch should reveal the drawer button')
assert(appsButton.visible === true, 'face touch should reveal the apps button')
controller.onDrawerToggle()
assert(viewBehavior.drawerOpen === true, 'the revealed drawer button action should open the drawer')
controller.onDrawerClose()
assert(viewBehavior.drawerOpen === false, 'closing the drawer should restore the face interaction layer')
assert(menuButton.visible === true, 'closing the drawer should reveal AppBar actions again')
assert(appsButton.visible === true, 'closing the drawer should reveal the apps button again')

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

let customScreenClosed = 0
let customBehaviorDisposed = 0
const customScreen = new Container(null, {
  Behavior: class extends Behavior {
    onDispose() {
      customBehaviorDisposed += 1
    }
  },
})
const closeCustomScreen = controller.setMain(customScreen, {
  onClose() {
    customScreenClosed += 1
  },
})
assert(viewBehavior.main === customScreen, 'setMain should display the custom main screen')
closeCustomScreen()
closeCustomScreen()
equal(viewBehavior.main, viewBehavior.faceMain, 'setMain cleanup handle should restore the face')
equal(customScreenClosed, 1, 'setMain onClose should run once when closed via handle')
equal(customBehaviorDisposed, 1, 'setMain content onDispose should run once when closed via handle')

let replacedScreenClosed = 0
controller.setMain(new Container(), () => {
  replacedScreenClosed += 1
})
controller.showMiniAppLauncher()
equal(replacedScreenClosed, 1, 'opening the mini-app launcher should notify the displaced main screen')
controller.showFace()

const closeOrder: string[] = []
const followUpScreen = new Container()
let closeFollowUp: (() => void) | undefined
controller.setMain(new Container(), () => {
  closeOrder.push('first')
  closeFollowUp = controller.setMain(followUpScreen, () => {
    closeOrder.push('follow-up')
  })
})
const closeReplacement = controller.setMain(new Container(), () => {
  closeOrder.push('replacement')
})
equal(viewBehavior.main, followUpScreen, 'setMain called by onClose should display the requested follow-up screen')
closeReplacement()
equal(viewBehavior.main, followUpScreen, 'a displaced screen handle should leave the follow-up screen open')
closeFollowUp?.()
closeFollowUp?.()
equal(closeOrder.join(','), 'first,replacement,follow-up', 'each displayed screen should close exactly once')
equal(viewBehavior.main, viewBehavior.faceMain, 'closing the follow-up should restore the face')

let dismissedOnShow = 0
const closeDismissedScreen = controller.setMain(
  new Container(null, {
    Behavior: class extends Behavior {
      onShow() {
        controller.showFace()
      }
    },
  }),
  () => {
    dismissedOnShow += 1
  },
)
closeDismissedScreen()
equal(viewBehavior.main, viewBehavior.faceMain, 'showFace called by onShow should restore the face')
assert(controller.isFaceForeground, 'the visible face should resume its foreground updates')
equal(dismissedOnShow, 1, 'the screen dismissed during onShow should close exactly once')

let closedReplacement = 0
const screenOpenedInHide = new Container()
controller.setMain(
  new Container(null, {
    Behavior: class extends Behavior {
      onHide() {
        controller.setMain(screenOpenedInHide)
      }
    },
  }),
)
controller.setMain(new Container(), () => {
  closedReplacement += 1
})
equal(viewBehavior.main, screenOpenedInHide, 'setMain called by onHide should display the requested screen')
equal(closedReplacement, 1, 'the screen displaced by an onHide request should close')
controller.showFace()

const successor = new Container()
controller.setMain(new Container(), () => {
  controller.showFace()
})
const closeSuccessor = controller.setMain(successor)
equal(viewBehavior.main, successor, 'an onClose face request should apply only to the departing screen')
closeSuccessor()

const sameContent = new Container()
controller.setMain(sameContent, () => {
  controller.showFace()
})
const closeSameContent = controller.setMain(sameContent)
equal(viewBehavior.main, sameContent, 'a successor may reuse the departing screen content')
closeSameContent()

controller.miniApps.register({
  id: 'test.departing',
  title: 'Departing',
  create() {
    return {
      content: new Container(),
      dispose() {
        controller.exitMiniApp()
        controller.showFace()
      },
    }
  },
})
assert(controller.launchMiniApp('test.departing'), 'the departing app should launch')
assert(controller.launchMiniApp('test.other'), 'the successor app should launch')
equal(title.string, 'Other', 'a departing app must not close the successor')
assert(!controller.isFaceForeground, 'the successor app should remain visible')
controller.showFace()

let nestedLaunch: boolean | undefined
let nestedCreates = 0
controller.miniApps.register({
  id: 'test.nested',
  title: 'Nested',
  create() {
    nestedCreates += 1
    return new Container()
  },
})
controller.setMain(new Container(), () => {
  nestedLaunch = controller.launchMiniApp('test.nested')
})
const closeNestedReplacement = controller.setMain(new Container())
equal(nestedLaunch, false, 'a nested launch must not report that an app started')
equal(nestedCreates, 0, 'a rejected nested launch must not run later')
closeNestedReplacement()

const afterFailingHook = new Container()
let closedAfterFailure = 0
controller.setMain(
  new Container(null, {
    Behavior: class extends Behavior {
      onHide() {
        controller.setMain(afterFailingHook)
        throw new Error('test onHide failure')
      }
    },
  }),
)
controller.setMain(new Container(), () => {
  closedAfterFailure += 1
})
equal(viewBehavior.main, afterFailingHook, 'a failing onHide must not prevent its queued screen request')
equal(closedAfterFailure, 1, 'screen replacement after a failing onHide should close its predecessor')
controller.showFace()

let closedFailingShow = 0
controller.setMain(
  new Container(null, {
    Behavior: class extends Behavior {
      onShow() {
        controller.showFace()
        throw new Error('test onShow failure')
      }
    },
  }),
  () => {
    closedFailingShow += 1
  },
)
equal(viewBehavior.main, viewBehavior.faceMain, 'a failing onShow must not prevent its queued close request')
equal(closedFailingShow, 1, 'a screen with a failing onShow must still close exactly once')

trace('@@STACKCHAN_TEST:PASS@@\n')
