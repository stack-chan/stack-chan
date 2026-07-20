import type { StackchanAppBehavior } from 'app-behavior'
import type { AppController } from 'app-controller'
import type { StackchanContext } from 'capabilities'
import type { Container as PiuContainer, Content as PiuContent, Port as PiuPort } from 'piu/MC'
import Timer from 'timer'

type TapBehavior = {
  onTouchBegan?: (content: PiuContent, id: number, x: number, y: number) => void
  onTouchEnded?: (content: PiuContent, id: number, x: number, y: number) => void
}

type GameBehavior = TapBehavior & { readonly jumping?: boolean; readonly score?: number }

type TestAppBar = PiuContainer & {
  content(name: string): PiuContainer
}

type ViewBehavior = {
  main?: PiuContainer
  faceMain?: PiuContainer
  appBar?: TestAppBar
}

type PositionedContainer = PiuContainer & {
  coordinates?: { top?: number }
  top?: number
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[MiniApp Lin Smoke] ${message}`)
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => Timer.set(() => resolve(), milliseconds))
}

function tap(content: PiuContent): void {
  const behavior = content.behavior as TapBehavior | undefined
  assert(behavior?.onTouchBegan && behavior.onTouchEnded, 'target is not a tappable Piu control')
  behavior.onTouchBegan(content, 0, 1, 1)
  behavior.onTouchEnded(content, 0, 1, 1)
}

function topOf(content: PiuContainer): number {
  const positioned = content as PositionedContainer
  return positioned.coordinates?.top ?? positioned.top ?? 0
}

async function runMiniAppSmoke(context: StackchanContext): Promise<void> {
  const controller = context.ui.controller as unknown as AppController
  const application = controller.application
  const view = application.first as PiuContainer
  const viewBehavior = view.behavior as ViewBehavior
  const faceMain = viewBehavior.faceMain
  const appBar = viewBehavior.appBar
  assert(faceMain && appBar, 'host FaceView and AppBar must be available')

  const appsButton = appBar.content('appsButton') as PiuContainer
  const backButton = appBar.content('backButton') as PiuContainer
  const title = appBar.content('title') as unknown as { string?: string }
  assert(appsButton.visible && appsButton.active, 'external archive registration must expose the Apps button')

  tap(appsButton)
  await wait(32)
  const launcherViewport = viewBehavior.main
  assert(launcherViewport && launcherViewport !== faceMain, 'Apps button must open the launcher')
  assert(topOf(launcherViewport) === 44, 'launcher must remain below the AppBar')
  assert(backButton.visible && backButton.active, 'launcher must expose the host-owned Back button')
  assert(String(title.string) === 'ミニアプリ', 'launcher must set its AppBar title')

  const launcher = launcherViewport.first as PiuContainer | null
  const scroller = launcher?.first as PiuContainer | null
  const column = scroller?.first as PiuContainer | null
  const sampleButton = column?.first as PiuContainer | null
  assert(sampleButton, 'launcher must contain the external sample app')

  tap(sampleButton)
  await wait(320)
  const appViewport = viewBehavior.main
  assert(appViewport && appViewport !== faceMain, 'sample app must replace the launcher')
  assert(topOf(appViewport) === 44, 'sample app must remain below the AppBar')
  const game = appViewport.first as PiuContainer | null
  const gamePort = game?.first as PiuPort | null
  assert(gamePort?.active, 'sample game must mount an active Piu Port')
  assert(backButton.visible && backButton.active, 'running app must retain the host-owned Back button')
  assert(String(title.string) === 'ｽﾀｯｸﾁｬﾝ JUMP', 'running app must set its AppBar title')

  const gameBehavior = gamePort.behavior as GameBehavior | undefined
  assert(gameBehavior?.score === 0, 'sample game must start with a zero score')
  tap(gamePort)
  assert(gameBehavior.jumping === true, 'tapping the game area must make Stack-chan jump')
  await wait(80)

  tap(backButton)
  await wait(32)
  assert(viewBehavior.main === faceMain, 'Back button must restore FaceView')
  assert(!backButton.visible && !backButton.active, 'FaceView must hide the mini-app Back button')
  assert(appsButton.visible && appsButton.active, 'registered mini app must remain available after exit')
  trace('[MiniApp Lin Smoke] ok\n')
}

const behavior: StackchanAppBehavior = {
  async onContextCreated(context) {
    await runMiniAppSmoke(context)
  },
}

export default behavior
