import { AppController } from 'app-controller'
import { FaceBehavior } from 'behaviors/face'
import type { StackchanContext } from 'capabilities'
import { ChatStatusBarState } from 'chat-status-bar'
import { SpeechBalloon } from 'effects/speech-balloon'
import { createFaceState, type FaceState, setColorRGB, toPiuColorNumber } from 'face-state'
import {
  Application,
  Container,
  Content,
  type Container as PiuContainer,
  type Content as PiuContent,
  type Port as PiuPort,
} from 'piu/MC'
import { StackchanRuntimeUI } from 'runtime-ui'
import { assert, equal } from 'testing/assert'

trace('=== face-view state test ===\n')

type RecorderContent = Content & {
  contextPrimary?: number
  eyeOpenLeft?: number
  eyeOpenRight?: number
  mouthOpen?: number
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
    miniApps: {
      register() {
        return () => {}
      },
    },
    update(_interval: number, _face: FaceState) {},
    addEffect(_effect: unknown) {},
    removeEffect(_effect: unknown) {},
    setFace(_face: PiuContainer) {},
    setHandAnimation() {},
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
          content.eyeOpenLeft = face.eyes.left.open
          content.eyeOpenRight = face.eyes.right.open
          content.mouthOpen = face.mouth.open
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

type HandRenderState = {
  visible: boolean
  shape: 'fist' | 'point' | 'peace' | 'open' | 'side-open'
  direction: string
  x: number
  y: number
}

type HandsBehaviorState = {
  leftState: HandRenderState
  rightState: HandRenderState
  primaryColor: number
  secondaryColor: number
  onDisplaying?: (port: PiuPort) => void
  onUndisplaying?: (port: PiuPort) => void
  onTimeChanged?: (port: PiuPort) => void
  onFinished?: (port: PiuPort) => void
  onHandAnimationChanged?: (port: PiuPort, animation: unknown) => boolean
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
const hands = findNamedNode(application as unknown as PiuContent, 'hands') as (PiuPort & TreeNode) | null
assert(hands, 'FaceView should install the hand renderer in its effect layer')
assert(!hands.first, 'both hands should be drawn by one fixed Port without movable child Ports')
const handsBehavior = hands.behavior as HandsBehaviorState
const leftHand = handsBehavior.leftState
const rightHand = handsBehavior.rightState
equal(leftHand.visible, false, 'left hand should initially be hidden')
equal(rightHand.visible, false, 'right hand should initially be hidden')
const initialHandPrimary = handsBehavior.primaryColor
controller.setHandAnimation('rock-paper-scissors')
equal(leftHand.visible, true, 'rock-paper-scissors should show the left hand')
equal(rightHand.visible, true, 'rock-paper-scissors should show the right hand')
equal(leftHand.shape, 'fist', 'rock-paper-scissors should begin with the fist sprite')
equal(leftHand.direction, 'up-right', 'the left rock-paper-scissors hand should lean inward')
equal(rightHand.direction, 'up-left', 'the right rock-paper-scissors hand should lean inward')
controller.setHandAnimation('clap')
equal(leftHand.visible, true, 'clapping should show the left hand')
equal(rightHand.visible, true, 'clapping should show the right hand')
equal(leftHand.shape, 'side-open', 'clapping should use the edge-on hand sprite')
equal(rightHand.shape, 'side-open', 'both clapping hands should remain edge-on')
equal(leftHand.direction, 'up-left', 'the left clapping hand should lean outward')
equal(rightHand.direction, 'up-right', 'the right clapping hand should lean outward')
controller.setHandAnimation('thinking')
equal(leftHand.visible, false, 'thinking should hide the unused left hand')
equal(rightHand.visible, true, 'thinking should keep the chin-side right hand visible')
equal(rightHand.shape, 'point', 'thinking should use the point sprite')
equal(rightHand.direction, 'up-left', 'thinking should point toward the chin')
const thinkingState = rightHand.shape
const thinkingDirection = rightHand.direction
handsBehavior.onHandAnimationChanged?.(hands, 'not-an-animation')
equal(leftHand.visible, false, 'unknown hand animations should preserve left-hand visibility')
equal(rightHand.visible, true, 'unknown hand animations should preserve right-hand visibility')
equal(rightHand.shape, thinkingState, 'unknown hand animations should preserve the current sprite state')
equal(rightHand.direction, thinkingDirection, 'unknown hand animations should preserve the current direction')
controller.setHandAnimation('none')
equal(leftHand.visible, false, 'none should hide the left hand')
equal(rightHand.visible, false, 'none should hide the right hand')
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
const expectedPrimary = toPiuColorNumber(desired.theme.primary)
const expectedSecondary = toPiuColorNumber(desired.theme.secondary)
assert(handsBehavior.primaryColor !== initialHandPrimary, 'face theme updates should recolor the hand sprites')
equal(handsBehavior.primaryColor, expectedPrimary, 'the outer hand mask should use the face primary color')
equal(handsBehavior.secondaryColor, expectedSecondary, 'the inner hand mask should use the face secondary color')

const nextFace = new TestFace({}) as PiuContainer
controller.setFace(nextFace)
const faceRegion = appData.FACE_REGION
assert(faceRegion, 'FaceView should expose the active face region anchor')
const initialVisualLeft = nodeCoordinate(faceRegion, 'left') + nodeCoordinate(nextFace, 'left')
const initialVisualTop = nodeCoordinate(faceRegion, 'top') + nodeCoordinate(nextFace, 'top')

const recorder = nextFace.first as RecorderContent
equal(recorder.skinPrimary, expectedPrimary, 'setFace should apply the active palette')
equal(recorder.contextPrimary, expectedPrimary, 'setFace should apply the active context')

const faceBehavior = nextFace.behavior as FaceBehavior
const skinHitsBeforeDisplaying = recorder.skinHits ?? 0
faceBehavior.onDisplaying(nextFace)
equal(recorder.contextPrimary, expectedPrimary, 'onDisplaying should keep the rehydrated context')
assert((recorder.skinHits ?? 0) > skinHitsBeforeDisplaying, 'onDisplaying should replay the cached palette')

application.distribute('onChatState', ChatStatusBarState.LISTENING)
assert(nextFace.running === false, 'assistant playback should stop autonomous face motion')
application.distribute('onChatState', ChatStatusBarState.WAITING)
assert(nextFace.running === false, 'buffered playback should keep autonomous face motion stopped')
application.distribute('onChatState', ChatStatusBarState.SPEAKING)
assert(nextFace.running === true, 'the user turn should restore autonomous face motion')

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
runtimeUI.setEyeOpen('left', 0.25)
runtimeUI.setEyeOpen('right', 0.75)
runtimeUI.setMouthOpen(0.5)
runtimeUI.updateFace(32)
faceBehavior.onTimeChanged(nextFace)
equal(recorder.eyeOpenLeft, 0.25, 'runtime face API should apply the left eyelid independently')
equal(recorder.eyeOpenRight, 0.75, 'runtime face API should apply the right eyelid independently')
equal(recorder.mouthOpen, 0.5, 'runtime face API should apply mouth opening')
runtimeUI.showBalloon('runtime balloon')

const runtimeBalloon = appData.EFFECTS?.last
assert(runtimeBalloon != null, 'showBalloon should attach a speech balloon effect')
const attachedBalloon = runtimeBalloon as BalloonContent
type PositionedBalloon = BalloonContent & {
  coordinates?: {
    left?: number
    right?: number
    top?: number
    bottom?: number
    height?: number
  }
}
const positionedBalloon = attachedBalloon as PositionedBalloon
equal(positionedBalloon.coordinates?.left, 16, 'showBalloon should use the default left margin')
equal(positionedBalloon.coordinates?.right, 16, 'showBalloon should use the default right margin')
equal(positionedBalloon.coordinates?.bottom, 12, 'showBalloon should anchor the default balloon to the bottom')
equal(positionedBalloon.coordinates?.top, undefined, 'showBalloon should not anchor the default balloon to the top')
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

const finishHandTransition = () => {
  hands.stop()
  handsBehavior.onFinished?.(hands)
  hands.stop()
}
handsBehavior.onDisplaying?.(hands)
controller.setHandAnimation('rock-paper-scissors')
const initialRockPaperScissorsState = leftHand.shape
finishHandTransition()
assert(leftHand.shape !== initialRockPaperScissorsState, 'rock-paper-scissors should advance to another sprite')

controller.setHandAnimation('clap')
const outerClapLeft = leftHand.x
const closingClapDuration = hands.duration
finishHandTransition()
const closedClapLeft = leftHand.x
assert(closedClapLeft > outerClapLeft + 16, 'clapping should move both hands toward the face center')
assert(closedClapLeft < outerClapLeft + 32, 'clapping should use a compact lateral motion')
equal(leftHand.shape, 'side-open', 'clapping should remain edge-on while the hands meet')
equal(rightHand.shape, 'side-open', 'both hands should remain edge-on while meeting')
equal(leftHand.direction, 'up', 'the meeting left hand should be upright')
equal(rightHand.direction, 'up', 'the meeting right hand should be upright')
const openingClapDuration = hands.duration
assert(closingClapDuration + openingClapDuration < 500, 'clapping should repeat more than twice per second')
finishHandTransition()
equal(leftHand.shape, 'side-open', 'clapping should stay edge-on while opening')
equal(rightHand.shape, 'side-open', 'both hands should stay edge-on while opening')
equal(leftHand.direction, 'up-left', 'the opening left hand should lean outward again')
equal(rightHand.direction, 'up-right', 'the opening right hand should lean outward again')
equal(leftHand.x, outerClapLeft, 'the left hand should return to its outer clapping position')

controller.setHandAnimation('thinking')
const initialThinkingTop = rightHand.y
finishHandTransition()
equal(leftHand.visible, false, 'thinking animation should keep the unused hand hidden')
equal(rightHand.visible, true, 'thinking animation should keep the chin-side hand visible')
assert(rightHand.y > initialThinkingTop, 'thinking should move the chin-side point sprite')
controller.setHandAnimation('none')
handsBehavior.onUndisplaying?.(hands)
trace('ok\n')
