import { AppController } from 'app-controller'
import { FaceBehavior } from 'behaviors/face'
import type { StackchanContext } from 'capabilities'
import { SpeechBalloon } from 'effects/speech-balloon'
import { createFaceState, type FaceState, setColorRGB, toPiuColorNumber } from 'face-state'
import { Application, Container, Content, type Container as PiuContainer, type Content as PiuContent } from 'piu/MC'
import { StackchanRuntimeUI } from 'runtime-ui'
import { assert, equal } from 'testing/assert'

trace('=== face-view state test ===\n')

type RecorderContent = Content & {
  contextPrimary?: number
  skinPrimary?: number
  contextHits?: number
  skinHits?: number
}

type RecorderBehavior = {
  onFaceState?: (content: RecorderContent, face: FaceState) => void
  onFaceSkin?: (content: RecorderContent, palette: { primaryColor: number }) => void
}

type BalloonNode = Content & {
  skin?: unknown
}

type BalloonContent = PiuContainer & {
  first?: BalloonNode | null
  behavior?: {
    onDisplaying?: (content: PiuContainer) => void
    onFaceState?: (content: PiuContainer, face: FaceState) => void
  }
}

type TestAppData = {
  face: PiuContainer
  FACE_REGION?: PiuContainer
  EFFECTS?: PiuContainer & { last?: BalloonContent | null }
}

type DrawerControllerCalls = {
  buttons: unknown[]
  states: [string, boolean][]
  removed: string[]
}

function createDrawerTestUI(calls: DrawerControllerCalls) {
  const actions = new Map<string, () => void>()
  return {
    update(_interval: number, _face: FaceState) {},
    addEffect(_effect: unknown) {},
    removeEffect(_effect: unknown) {},
    setFace(_face: PiuContainer) {},
    setMain(_content: PiuContainer) {},
    showFace() {},
    setDrawerButtons(buttons: unknown[]) {
      calls.buttons = buttons
    },
    addDrawerButton(button: unknown) {
      calls.buttons.push(button)
    },
    removeDrawerButton(key: string) {
      calls.removed.push(key)
    },
    setDrawerButtonState(key: string, active: boolean) {
      calls.states.push([key, active])
    },
    bindDrawerAction(key: string, callback: () => void) {
      actions.set(key, callback)
      return true
    },
    unbindDrawerAction(key: string) {
      actions.delete(key)
    },
    openDrawer() {},
    closeDrawer() {},
    toggleDrawer() {},
    hasDrawerAction(key: string) {
      return actions.has(key)
    },
  }
}

const TestFace = Container.template(() => ({
  left: 60,
  top: 60,
  width: 200,
  height: 120,
  active: true,
  contents: [
    new Content(null, {
      left: 0,
      top: 0,
      width: 1,
      height: 1,
      Behavior: class extends Behavior {
        onCreate(content: RecorderContent) {
          content.contextPrimary = -1
          content.skinPrimary = -1
          content.contextHits = 0
          content.skinHits = 0
        }

        onFaceState(content: RecorderContent, face: FaceState) {
          content.contextPrimary = toPiuColorNumber(face.theme.primary)
          content.contextHits = (content.contextHits ?? 0) + 1
        }

        onFaceSkin(content: RecorderContent, palette: { primaryColor: number }) {
          content.skinPrimary = palette.primaryColor
          content.skinHits = (content.skinHits ?? 0) + 1
        }
      },
    }),
  ],
  Behavior: class extends FaceBehavior {
    constructor() {
      super({ motions: [] })
    }
  },
}))

const ResizedFace = Container.template(() => ({
  left: 20,
  top: 30,
  width: 96,
  height: 72,
  active: true,
  contents: [],
  Behavior: class extends FaceBehavior {
    constructor() {
      super({ motions: [] })
    }

    get breathPixels() {
      return 12
    }
  },
}))

function nodeCoordinate(node: PiuContainer, key: 'left' | 'top' | 'width' | 'height'): number {
  type PositionedNode = PiuContainer & {
    coordinates?: Partial<Record<'left' | 'top' | 'width' | 'height', number>>
    left?: number
    top?: number
    width?: number
    height?: number
  }
  const positioned = node as PositionedNode
  return positioned.coordinates?.[key] ?? positioned[key] ?? 0
}

type TreeNode = PiuContent & {
  name?: string
  first?: PiuContent | null
  next?: PiuContent | null
}

function findNamedNode(root: PiuContent | null | undefined, name: string): TreeNode | null {
  if (!root) return null
  const stack: TreeNode[] = [root as TreeNode]
  while (stack.length > 0) {
    const node = stack.pop() as TreeNode
    if (node.name === name) return node
    let child = node.first as PiuContent | null
    while (child) {
      stack.push(child as TreeNode)
      child = (child as TreeNode).next as PiuContent | null
    }
  }
  return null
}

function findDrawer(root: PiuContainer): PiuContainer {
  const drawer = findNamedNode(root as unknown as PiuContent, 'drawer') as PiuContainer | null
  assert(drawer, 'Application should contain the Drawer node')
  return drawer
}

const appData: TestAppData = {
  face: new TestFace({}),
}
const application = new Application(appData, {
  displayListLength: 2047,
  contents: [],
  Behavior: AppController,
})

const controller = application.behavior as AppController
const initialDrawer = findDrawer(application as unknown as PiuContainer)
let selectedChoice = ''
assert(
  controller.bindDrawerAction('choiceTest', (value) => {
    selectedChoice = value ?? ''
  }),
  'choice callback should bind to the application controller',
)
controller.addDrawerButton({
  key: 'choiceTest',
  label: 'Choice',
  kind: 'choice',
  value: 'first',
  options: [
    { value: 'first', label: 'First' },
    { value: 'second', label: 'Second' },
  ],
})
const initialDrawerBehavior = initialDrawer.behavior as {
  onDrawerChoiceSelected?: (container: PiuContainer, selection: { key: string; value: string }) => void
}
initialDrawerBehavior.onDrawerChoiceSelected?.(initialDrawer, { key: 'choiceTest', value: 'second' })
equal(selectedChoice, 'second', 'drawer choice selection should bubble to its bound application callback')
controller.unbindDrawerAction('choiceTest')
controller.removeDrawerButton('choiceTest')
controller.addDrawerButton({ key: 'dynamicA', label: 'Dynamic A' })
equal(
  findDrawer(application as unknown as PiuContainer),
  initialDrawer,
  'addDrawerButton should update the existing drawer',
)
assert(
  findNamedNode(initialDrawer as unknown as PiuContent, 'dynamicA'),
  'addDrawerButton should append the button node',
)
controller.addDrawerButton({ key: 'dynamicB', label: 'Dynamic B' })
equal(
  findDrawer(application as unknown as PiuContainer),
  initialDrawer,
  'consecutive addDrawerButton calls should not rebuild the drawer',
)
controller.addDrawerButton({ key: 'dynamicA', label: 'Dynamic A+', kind: 'toggle' })
equal(
  findDrawer(application as unknown as PiuContainer),
  initialDrawer,
  'addDrawerButton should replace an existing key without rebuilding the drawer',
)
controller.setDrawerButtonState('dynamicA', true)
controller.removeDrawerButton('dynamicA')
equal(
  findDrawer(application as unknown as PiuContainer),
  initialDrawer,
  'removeDrawerButton should update the existing drawer',
)
assert(
  !findNamedNode(initialDrawer as unknown as PiuContent, 'dynamicA'),
  'removeDrawerButton should remove the button node',
)
controller.removeDrawerButton('dynamicB')
const desired = createFaceState()
setColorRGB(desired.theme.primary, 0x22, 0x55, 0xaa)
setColorRGB(desired.theme.secondary, 0xdd, 0xee, 0xff)
controller.update(32, desired)

const nextFace = new TestFace({}) as PiuContainer
controller.setFace(nextFace)
const faceRegion = appData.FACE_REGION
assert(faceRegion, 'FaceView should expose the active face region anchor')
const initialVisualLeft = nodeCoordinate(faceRegion, 'left') + nodeCoordinate(nextFace, 'left')
const initialVisualTop = nodeCoordinate(faceRegion, 'top') + nodeCoordinate(nextFace, 'top')

const recorder = nextFace.first as RecorderContent
const expectedPrimary = toPiuColorNumber(desired.theme.primary)
equal(recorder.skinPrimary, expectedPrimary, 'setFace should apply the active palette')
equal(recorder.contextPrimary, expectedPrimary, 'setFace should apply the active context')

const faceBehavior = nextFace.behavior as FaceBehavior
const skinHitsBeforeDisplaying = recorder.skinHits ?? 0
faceBehavior.onDisplaying(nextFace)
equal(recorder.contextPrimary, expectedPrimary, 'onDisplaying should keep the rehydrated context')
assert((recorder.skinHits ?? 0) > skinHitsBeforeDisplaying, 'onDisplaying should replay the cached palette')

const resizedFace = new ResizedFace({}) as PiuContainer
controller.setFace(resizedFace)
equal(nodeCoordinate(resizedFace, 'left'), 12, 'setFace should offset a custom face by its breath padding')
equal(nodeCoordinate(resizedFace, 'top'), 12, 'setFace should offset a custom face vertically by its breath padding')
equal(nodeCoordinate(faceRegion, 'width'), 120, 'setFace should resize the clip region width for a custom face')
equal(nodeCoordinate(faceRegion, 'height'), 96, 'setFace should resize the clip region height for a custom face')
equal(
  nodeCoordinate(faceRegion, 'left') + nodeCoordinate(resizedFace, 'left'),
  initialVisualLeft,
  'setFace should preserve the visual face left when clip padding changes',
)
equal(
  nodeCoordinate(faceRegion, 'top') + nodeCoordinate(resizedFace, 'top'),
  initialVisualTop,
  'setFace should preserve the visual face top when clip padding changes',
)
controller.setFace(nextFace)

const skinHitsBeforeResume = recorder.skinHits ?? 0
faceBehavior.pause(nextFace)
faceBehavior.resume(nextFace)
equal(recorder.contextPrimary, expectedPrimary, 'resume should keep the rehydrated context')
assert((recorder.skinHits ?? 0) > skinHitsBeforeResume, 'resume should replay the cached palette')

const recorderBehavior = recorder.behavior as RecorderBehavior
assert(typeof recorderBehavior.onFaceState === 'function', 'recorder should receive face context events')
assert(typeof recorderBehavior.onFaceSkin === 'function', 'recorder should receive face skin events')

controller.setDrawerButtonState('speech', true)
const effectRecorder = new Content(null, {
  Behavior: class extends Behavior {
    onCreate(content: RecorderContent) {
      content.contextPrimary = -1
      content.skinPrimary = -1
    }

    onFaceState(content: RecorderContent, face: FaceState) {
      content.contextPrimary = toPiuColorNumber(face.theme.primary)
    }

    onFaceSkin(content: RecorderContent, palette: { primaryColor: number }) {
      content.skinPrimary = palette.primaryColor
    }
  },
}) as RecorderContent
controller.addEffect(effectRecorder, 'recorder')
equal(effectRecorder.skinPrimary, expectedPrimary, 'addEffect should apply the active palette')
equal(effectRecorder.contextPrimary, expectedPrimary, 'addEffect should apply the active context')
controller.addEffect(new SpeechBalloon({ name: 'speech', text: 'hello' }), 'speech')
controller.update(32, desired)
controller.removeEffectByKey('recorder')
controller.removeEffectByKey('speech')
controller.setDrawerButtonState('speech', false)

const defaultReference = new SpeechBalloon({ text: 'default reference' }) as BalloonContent
defaultReference.behavior?.onDisplaying?.(defaultReference)
defaultReference.behavior?.onFaceState?.(defaultReference, createFaceState())
const defaultSkin = defaultReference.first?.skin
assert(defaultSkin != null, 'reference balloon should initialize a default skin')

const zeroPose = Object.freeze({
  position: { x: 0, y: 0, z: 0 },
  rotation: { r: 0, p: 0, y: 0 },
})
const runtimeUI = new StackchanRuntimeUI(controller, {
  getContext: () => ({}) as StackchanContext,
  getPose: () => ({
    body: zeroPose,
    eyes: {
      left: zeroPose,
      right: zeroPose,
    },
  }),
  getGazePoint: () => null,
  isPaused: () => false,
})
runtimeUI.setColor('primary', 0x12, 0x34, 0x56)
runtimeUI.setColor('secondary', 0xab, 0xcd, 0xef)
runtimeUI.updateFace(32)
runtimeUI.showBalloon('runtime balloon', { left: 8, top: 8, width: 120 })

const runtimeBalloon = appData.EFFECTS?.last
assert(runtimeBalloon != null, 'showBalloon should attach a speech balloon effect')
const attachedBalloon = runtimeBalloon as BalloonContent
assert(
  attachedBalloon.first?.skin !== defaultSkin,
  'showBalloon should replay the active face state to newly attached balloons',
)
runtimeUI.hideBalloon()

const oldDrawerCalls: DrawerControllerCalls = { buttons: [], states: [], removed: [] }
const newDrawerCalls: DrawerControllerCalls = { buttons: [], states: [], removed: [] }
const oldDrawerUI = createDrawerTestUI(oldDrawerCalls)
const newDrawerUI = createDrawerTestUI(newDrawerCalls)
const drawerRuntime = new StackchanRuntimeUI(oldDrawerUI, {
  getContext: () => ({}) as StackchanContext,
  getPose: () => ({
    body: zeroPose,
    eyes: {
      left: zeroPose,
      right: zeroPose,
    },
  }),
  getGazePoint: () => null,
  isPaused: () => false,
})
drawerRuntime.drawer.addDrawerButton({
  key: 'swap',
  label: 'Swap',
  kind: 'toggle',
  initialState: true,
  callback() {},
})
assert(oldDrawerUI.hasDrawerAction('swap'), 'drawer callback should bind to the initial UI')
drawerRuntime.useUI(newDrawerUI)
assert(!oldDrawerUI.hasDrawerAction('swap'), 'useUI should detach drawer callbacks from the old UI')
assert(newDrawerUI.hasDrawerAction('swap'), 'useUI should bind drawer callbacks to the new UI')
equal(newDrawerCalls.buttons.length, 1, 'useUI should rebuild drawer buttons on the new application')
equal(newDrawerCalls.states[0]?.[0], 'swap', 'useUI should replay drawer button state')
equal(newDrawerCalls.states[0]?.[1], true, 'useUI should replay active drawer state')
drawerRuntime.drawer.removeDrawerButton('swap')
assert(!newDrawerUI.hasDrawerAction('swap'), 'removeDrawerButton should detach from the current UI')
equal(newDrawerCalls.removed[0], 'swap', 'removeDrawerButton should update the current drawer controller')
equal(oldDrawerCalls.removed.length, 0, 'removeDrawerButton should not mutate the old drawer controller after useUI')

trace('ok\n')
