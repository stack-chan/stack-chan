import { AppController } from 'app-controller'
import { DogFace, FaceBase, ImageFace, SimpleFace } from 'behaviors/face'
import { createFaceSkinPalette } from 'face-skin'
import { createFaceState, Emotion, type FaceState, setColorRGB } from 'face-state'
import { Eye } from 'parts/eye'
import { eyeOpenToVariant, IRIS_SPRITE } from 'parts/image/atlas'
import { Content, type Content as PiuContent } from 'piu/MC'
import { assert, equal } from 'testing/assert'

trace('=== face rendering test ===\n')

type PiuNode = {
  first?: PiuNode
  next?: PiuNode
  behavior?: unknown
  interval?: number
  top?: number
  coordinates?: { left?: number; top?: number; width?: number; height?: number }
  fillOutline?: unknown
  strokeOutline?: unknown
  skin?: unknown
  state?: number
  variant?: number
}

type BreathRecorder = PiuNode & {
  lastBreath?: number
  lastMouth?: number
  calls?: number
}

function childAt(container: PiuNode, index: number): PiuNode {
  let child = container.first
  for (let i = 0; i < index; i++) {
    child = child?.next
  }
  assert(child, `child ${index} should exist`)
  return child as PiuNode
}

function applyFaceState(faceNode: PiuNode, face = createFaceState()) {
  const palette = createFaceSkinPalette(0xffffff, 0x000000)
  ;(faceNode as PiuNode & { distribute?: (id: string, value: unknown) => void }).distribute?.('onFaceSkin', palette)
  ;(faceNode as PiuNode & { distribute?: (id: string, value: unknown) => void }).distribute?.('onFaceState', face)
  return palette
}

function assertChanged(before: unknown, after: unknown, message: string) {
  assert(before !== after, message)
  assert(after !== undefined, `${message}: next value should be defined`)
}

function topOf(node: PiuNode): number | undefined {
  return node.coordinates?.top ?? node.top
}

const simpleFace = new SimpleFace({ motions: [] }) as PiuNode
const simpleLeftEye = childAt(simpleFace, 0)
const simpleLeftIris = childAt(simpleLeftEye, 0)
const simpleLeftEyelid = childAt(simpleLeftEye, 1)
const simpleMouth = childAt(simpleFace, 2)

const defaultPalette = applyFaceState(simpleFace)
equal(simpleLeftIris.skin, defaultPalette.primary, 'standard iris should use the primary face skin')
equal(simpleLeftEyelid.skin, defaultPalette.secondary, 'standard eyelid should use the secondary face skin')
assert(simpleLeftIris.fillOutline, 'standard iris should render through a Shape fill outline')
assert(simpleLeftEyelid.fillOutline, 'standard eyelid should render through a Shape fill outline')
assert(simpleMouth, 'standard mouth should be present')

const roundRectEye = new Eye({
  cx: 50,
  cy: 40,
  shape: 'roundRect',
  width: 28,
  height: 16,
  r: 5,
  side: 'left',
  eyelidWidth: 28,
  eyelidHeight: 16,
}) as PiuNode
const roundRectIris = childAt(roundRectEye, 0)
const roundRectEyelid = childAt(roundRectEye, 1)
assert(roundRectIris.fillOutline, 'round rect iris should render through a Shape fill outline')
assert(roundRectEyelid.fillOutline, 'round rect iris should retain an eyelid')
equal(roundRectIris.coordinates?.width, 28, 'round rect iris should preserve its width')
equal(roundRectIris.coordinates?.height, 16, 'round rect iris should preserve its height')

const neutralEyelid = simpleLeftEyelid.fillOutline
const angryFace = createFaceState()
angryFace.emotion = Emotion.ANGRY
angryFace.eyes.left.open = 0.5
applyFaceState(simpleFace, angryFace)
assertChanged(neutralEyelid, simpleLeftEyelid.fillOutline, 'standard eyelid should change for angry expression')

const angryEyelid = simpleLeftEyelid.fillOutline
const happyFace = createFaceState()
happyFace.emotion = Emotion.HAPPY
happyFace.eyes.left.open = 0.5
applyFaceState(simpleFace, happyFace)
assertChanged(angryEyelid, simpleLeftEyelid.fillOutline, 'standard eyelid should change for happy expression')

const themedFace = createFaceState()
setColorRGB(themedFace.theme.primary, 0x12, 0x34, 0x56)
setColorRGB(themedFace.theme.secondary, 0x65, 0x43, 0x21)
const themedPalette = createFaceSkinPalette(0x123456, 0x654321)
;(simpleFace as PiuNode & { distribute?: (id: string, value: unknown) => void }).distribute?.(
  'onFaceSkin',
  themedPalette,
)
;(simpleFace as PiuNode & { distribute?: (id: string, value: unknown) => void }).distribute?.('onFaceState', themedFace)
equal(simpleLeftIris.skin, themedPalette.primary, 'standard iris should keep theme color through the primary skin')
equal(
  simpleLeftEyelid.skin,
  themedPalette.secondary,
  'standard eyelid should keep theme color through the secondary skin',
)

const dogFace = new DogFace({ motions: [] }) as PiuNode
const dogLeftEyelid = childAt(childAt(dogFace, 0), 1)
const dogLeftEyebrow = childAt(dogFace, 2)
const dogMouth = childAt(dogFace, 4)
const dogNose = childAt(dogFace, 5)
const dogClosed = createFaceState()
dogClosed.emotion = Emotion.SAD
dogClosed.eyes.left.open = 0.7
dogClosed.mouth.open = 0
applyFaceState(dogFace, dogClosed)
assert(dogLeftEyelid.fillOutline, 'DogFace eyelid should render through a Shape fill outline')
assert(dogLeftEyebrow.fillOutline, 'DogFace eyebrow should render through a curved fill outline')
assert(dogMouth.strokeOutline, 'DogFace mouth should render through a curved stroke outline')
assert(dogNose.fillOutline, 'DogFace nose should render through a curved fill outline')

const dogEyebrowSad = dogLeftEyebrow.fillOutline
const dogMouthClosed = dogMouth.strokeOutline
const dogNoseClosed = dogNose.fillOutline
const dogOpen = createFaceState()
dogOpen.emotion = Emotion.ANGRY
dogOpen.eyes.left.open = 0.2
dogOpen.mouth.open = 1
applyFaceState(dogFace, dogOpen)
assertChanged(dogEyebrowSad, dogLeftEyebrow.fillOutline, 'DogFace eyebrow should change with expression and eye open')
assertChanged(dogMouthClosed, dogMouth.strokeOutline, 'DogFace mouth should change with mouth open')
assertChanged(dogNoseClosed, dogNose.fillOutline, 'DogFace nose should change with mouth open')

const imageFace = new ImageFace({ motions: [] }) as PiuNode
const imageLeftEye = childAt(imageFace, 0)
const imageLeftIris = childAt(imageLeftEye, 0)
const imageLeftEyelid = childAt(imageLeftEye, 1)
const imageOpen = createFaceState()
imageOpen.eyes.left.open = 1
imageOpen.eyes.left.gazeX = 0
imageOpen.eyes.left.gazeY = 0
applyFaceState(imageFace, imageOpen)
equal(imageLeftEyelid.variant, eyeOpenToVariant(1), 'ImageFace eyelid should start from the open sprite variant')

const imageClosed = createFaceState()
imageClosed.eyes.left.open = 0
imageClosed.eyes.left.gazeX = 1
imageClosed.eyes.left.gazeY = -1
applyFaceState(imageFace, imageClosed)
equal(imageLeftEyelid.variant, eyeOpenToVariant(0), 'ImageFace eyelid should switch to the closed sprite variant')
assert(imageLeftIris.coordinates, 'ImageFace iris should update coordinates for gaze')
equal(imageLeftIris.coordinates?.left, IRIS_SPRITE.baseLeft + IRIS_SPRITE.maxOffset)
equal(imageLeftIris.coordinates?.top, IRIS_SPRITE.baseTop - IRIS_SPRITE.maxOffset)

const breathRecorder = new Content(null, {
  left: 0,
  top: 0,
  width: 1,
  height: 1,
  Behavior: class extends Behavior {
    onFaceState(content: BreathRecorder, face: FaceState) {
      content.calls = (content.calls ?? 0) + 1
      content.lastBreath = face.breath
    }
  },
}) as BreathRecorder
const breathingFace = new FaceBase({ contents: [breathRecorder as unknown as PiuContent], intervalMs: 33 }) as PiuNode
const breathingBehavior = breathingFace.behavior as {
  onCreate?: (node: PiuNode) => void
  onTimeChanged?: (node: PiuNode) => void
}
breathingBehavior.onCreate?.(breathingFace)
const initialBreath = breathRecorder.lastBreath
let breathChanged = false
for (let i = 0; i < 32; i++) {
  breathingBehavior.onTimeChanged?.(breathingFace)
  breathChanged ||= breathRecorder.lastBreath !== initialBreath
}
assert(breathChanged, 'default FaceBehavior should update face breath')

let controlledBreath = 0
const controlledRecorder = new Content(null, {
  left: 0,
  top: 0,
  width: 1,
  height: 1,
  Behavior: class extends Behavior {
    onFaceState(content: BreathRecorder, face: FaceState) {
      content.calls = (content.calls ?? 0) + 1
      content.lastBreath = face.breath
    }
  },
}) as BreathRecorder
const controlledFace = new FaceBase({
  contents: [controlledRecorder as unknown as PiuContent],
  intervalMs: 33,
  motions: [
    (_tick, face) => {
      face.breath = controlledBreath
    },
  ],
}) as PiuNode
const controlledBehavior = controlledFace.behavior as {
  onCreate?: (node: PiuNode) => void
  onTimeChanged?: (node: PiuNode) => void
}
controlledBehavior.onCreate?.(controlledFace)
controlledBehavior.onTimeChanged?.(controlledFace)
const callsAfterZero = controlledRecorder.calls
controlledBreath = 0.08
controlledBehavior.onTimeChanged?.(controlledFace)
equal(
  controlledRecorder.calls,
  callsAfterZero,
  'FaceBehavior should skip onFaceState distribution for sub-pixel breath changes',
)
controlledBreath = 0.09
controlledBehavior.onTimeChanged?.(controlledFace)
assert(
  (controlledRecorder.calls ?? 0) > (callsAfterZero ?? 0),
  'FaceBehavior should distribute onFaceState after breath crosses a rendered pixel',
)

const disabledMotionRecorder = new Content(null, {
  left: 0,
  top: 0,
  width: 1,
  height: 1,
  Behavior: class extends Behavior {
    onFaceState(content: BreathRecorder, face: FaceState) {
      content.lastMouth = face.mouth.open
    }
  },
}) as BreathRecorder
const disabledMotionFace = new FaceBase({
  contents: [disabledMotionRecorder as unknown as PiuContent],
  motions: [],
}) as PiuNode
const disabledMotionBehavior = disabledMotionFace.behavior as {
  onCreate?: (node: PiuNode) => void
  onFaceUpdate?: (node: PiuNode, face: FaceState) => void
  setMotionsEnabled?: (node: PiuNode, enabled: boolean) => void
}
disabledMotionBehavior.onCreate?.(disabledMotionFace)
disabledMotionBehavior.setMotionsEnabled?.(disabledMotionFace, false)
const speakingFace = createFaceState()
speakingFace.mouth.open = 0.7
disabledMotionBehavior.onFaceUpdate?.(disabledMotionFace, speakingFace)
equal(
  disabledMotionRecorder.lastMouth,
  0.7,
  'FaceBehavior should render app-driven mouth updates while autonomous motions are disabled',
)

const movingFace = new SimpleFace({ intervalMs: 33 }) as PiuNode
const movingLeftEye = childAt(movingFace, 0)
const movingLeftIris = childAt(movingLeftEye, 0)
const movingLeftEyelid = childAt(movingLeftEye, 1)
const movingBehavior = movingFace.behavior as {
  onCreate?: (node: PiuNode) => void
  onTimeChanged?: (node: PiuNode) => void
}
movingBehavior.onCreate?.(movingFace)
const initialMovingTop = topOf(movingFace)
const initialMovingIrisLeft = movingLeftIris.coordinates?.left
const initialMovingIrisTop = movingLeftIris.coordinates?.top
const initialMovingEyelid = movingLeftEyelid.fillOutline
let breathingMoved = false
let blinkChanged = false
let saccadeChanged = false
for (let i = 0; i < 220; i++) {
  movingBehavior.onTimeChanged?.(movingFace)
  breathingMoved ||= topOf(movingFace) !== initialMovingTop
  blinkChanged ||= movingLeftEyelid.fillOutline !== initialMovingEyelid
  saccadeChanged ||=
    movingLeftIris.coordinates?.left !== initialMovingIrisLeft ||
    movingLeftIris.coordinates?.top !== initialMovingIrisTop
}
assert(breathingMoved, 'default FaceBehavior should move the face container for breathing')
assert(blinkChanged, 'default FaceBehavior should change eyelid outlines for blinking')
assert(saccadeChanged, 'default FaceBehavior should move iris coordinates for saccade')

let appMotionTicks = 0
const appDrivenFace = new SimpleFace({
  intervalMs: 33,
  motions: [
    (_tick, face) => {
      appMotionTicks += 1
      face.breath = -1
      face.eyes.left.open = 0
      face.eyes.right.open = 0
    },
  ],
}) as PiuNode
const appDrivenLeftEyelid = childAt(childAt(appDrivenFace, 0), 1)
const appDrivenApplication = new Application(
  { face: appDrivenFace },
  {
    displayListLength: 2047,
    contents: [],
    Behavior: AppController,
  },
)
assert(appDrivenApplication.behavior, 'AppController-hosted Application should stay alive for mounted face tests')
const initialAppDrivenTop = topOf(appDrivenFace)
const initialAppDrivenEyelid = appDrivenLeftEyelid.fillOutline
const appDrivenBehavior = appDrivenFace.behavior as {
  onDisplaying?: (node: PiuNode) => void
  onTimeChanged?: (node: PiuNode) => void
}
appDrivenBehavior.onDisplaying?.(appDrivenFace)
appDrivenBehavior.onTimeChanged?.(appDrivenFace)
assert(appMotionTicks > 0, 'AppController-hosted FaceBehavior should retain custom motions after mounting')
assert(topOf(appDrivenFace) !== initialAppDrivenTop, 'AppController-hosted face should move for breathing')
assert(
  appDrivenLeftEyelid.fillOutline !== initialAppDrivenEyelid,
  'AppController-hosted face should update eyelid outlines for blinking',
)
trace('ok\n')
