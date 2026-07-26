import { AppController } from 'app-controller'
import { DogFace, FaceBase, ImageFace, SimpleFace } from 'behaviors/face'
import { createFaceSkinPalette } from 'face-skin'
import {
  createEmotionWeights,
  createFaceState,
  Emotion,
  type FaceState,
  setColorRGB,
  writeEmotionTransition,
} from 'face-state'
import { Eye } from 'parts/eye'
import { createEyelidAperture, writeEyelidAperture } from 'parts/eyelid-geometry'
import { Gray16Mask } from 'parts/gray16-mask'
import { eyeOpenToVariant, IRIS_SPRITE } from 'parts/image/atlas'
import { Content, type Content as PiuContent } from 'piu/MC'
import { assert, equal } from 'testing/assert'

trace('=== face rendering test ===\n')

type PiuNode = {
  first?: PiuNode
  next?: PiuNode
  behavior?: {
    revision?: number
    onDraw?: (
      port: { drawGray: (bitmap: unknown, color: number, ...region: number[]) => void },
      x?: number,
      y?: number,
      width?: number,
      height?: number,
    ) => void
  }
  drawGray?: unknown
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

function maskRevision(node: PiuNode): number {
  return node.behavior?.revision ?? 0
}

function assertMaskPort(node: PiuNode, message: string) {
  assert(typeof node.drawGray === 'function', message)
  assert(!node.fillOutline, `${message}: fill Outline should not be present`)
  assert(!node.strokeOutline, `${message}: stroke Outline should not be present`)
}

function drawnMaskColor(node: PiuNode): number | undefined {
  let drawnColor: number | undefined
  node.behavior?.onDraw?.({
    drawGray(_bitmap, color) {
      drawnColor = color
    },
  })
  return drawnColor
}

function drawnMask(node: PiuNode): Gray16Mask | undefined {
  let drawnMask: Gray16Mask | undefined
  node.behavior?.onDraw?.({
    drawGray(bitmap) {
      drawnMask = bitmap as Gray16Mask
    },
  })
  return drawnMask
}

function drawGrayArgumentCount(node: PiuNode, x: number, y: number, width: number, height: number): number {
  let argumentCount = 0
  node.behavior?.onDraw?.(
    {
      drawGray(...args) {
        argumentCount = args.length
      },
    },
    x,
    y,
    width,
    height,
  )
  return argumentCount
}

function coveredPixelCount(mask: Gray16Mask): number {
  let covered = 0
  for (let y = 0; y < mask.height; y++) {
    for (let x = 0; x < mask.width; x++) {
      if (maskAlphaAt(mask, x, y) < 15) covered++
    }
  }
  return covered
}

function topOf(node: PiuNode): number | undefined {
  return node.coordinates?.top ?? node.top
}

function maskAlphaAt(mask: Gray16Mask, x: number, y: number): number {
  const packed = mask.bytes[(y * mask.strideWidth + x) >> 1]
  return (x & 1) === 0 ? packed >> 4 : packed & 0x0f
}

const primitiveMask = new Gray16Mask(8, 8)
equal(maskAlphaAt(primitiveMask, 4, 4), 15, 'a new Gray16 mask should start transparent')
primitiveMask.fillCircle(4, 4, 2)
equal(maskAlphaAt(primitiveMask, 4, 4), 0, 'the native circle rasterizer should cover its center')
equal(maskAlphaAt(primitiveMask, 0, 0), 15, 'the native circle rasterizer should preserve distant pixels')
primitiveMask.fillOutsideAperture({
  topLeft: 2,
  topRight: 2,
  bottomLeft: 6,
  bottomRight: 6,
})
equal(maskAlphaAt(primitiveMask, 4, 0), 0, 'the native eyelid rasterizer should cover above the aperture')
equal(maskAlphaAt(primitiveMask, 4, 4), 15, 'the native eyelid rasterizer should leave the aperture transparent')
equal(maskAlphaAt(primitiveMask, 4, 7), 0, 'the native eyelid rasterizer should cover below the aperture')

const simpleFace = new SimpleFace({ motions: [] }) as PiuNode
const simpleLeftEye = childAt(simpleFace, 0)
const simpleLeftIris = childAt(simpleLeftEye, 0)
const simpleLeftEyelid = childAt(simpleLeftEye, 1)
const simpleMouth = childAt(simpleFace, 2)

const defaultPalette = applyFaceState(simpleFace)
assert(defaultPalette, 'standard face should accept the default face palette')
assertMaskPort(simpleLeftIris, 'standard iris should render through a Gray16 mask port')
assertMaskPort(simpleLeftEyelid, 'standard eyelid should render through a Gray16 mask port')
equal(drawnMaskColor(simpleLeftIris), defaultPalette.primaryColor, 'standard iris should use the primary face color')
equal(
  drawnMaskColor(simpleLeftEyelid),
  defaultPalette.secondaryColor,
  'standard eyelid should use the secondary face color',
)
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
assertMaskPort(roundRectIris, 'round rect iris should render through a Gray16 mask port')
assertMaskPort(roundRectEyelid, 'round rect iris should retain a Gray16 eyelid')
equal(roundRectIris.coordinates?.width, 28, 'round rect iris should preserve its width')
equal(roundRectIris.coordinates?.height, 16, 'round rect iris should preserve its height')

const scaledCircleEye = new Eye({
  cx: 50,
  cy: 40,
  radius: 12,
  side: 'right',
}) as PiuNode
const scaledCircleEyelid = childAt(scaledCircleEye, 1)
equal(scaledCircleEye.coordinates?.width, 36, 'the default eyelid width should scale from the iris radius')
equal(scaledCircleEye.coordinates?.height, 36, 'the default eyelid height should scale from the iris radius')
equal(scaledCircleEyelid.coordinates?.width, 36, 'the rendered eyelid mask should use the scaled width')

const scalableAperture = createEyelidAperture()
const scalableFace = createFaceState()
writeEyelidAperture(scalableAperture, scalableFace, 'left', 1, 120)
equal(scalableAperture.topLeft, 0, 'an open neutral eyelid should begin at the top edge')
equal(scalableAperture.topRight, 0, 'an open neutral eyelid should preserve a level top edge')
equal(scalableAperture.bottomLeft, 120, 'an open neutral eyelid should scale to the configured eye height')
equal(scalableAperture.bottomRight, 120, 'the neutral lower edge should scale with the eye height')
writeEyelidAperture(scalableAperture, scalableFace, 'left', 0, 120)
equal(scalableAperture.topLeft, 120, 'a closed neutral eyelid should meet the lower edge')
equal(scalableAperture.topRight, 120, 'a closed neutral eyelid should remain level')

const mirroredLeftAperture = createEyelidAperture()
const mirroredRightAperture = createEyelidAperture()
for (const emotion of [Emotion.ANGRY, Emotion.SAD]) {
  const mirroredFace = createFaceState()
  mirroredFace.emotion = emotion
  writeEyelidAperture(mirroredLeftAperture, mirroredFace, 'left', 0.5, 24)
  writeEyelidAperture(mirroredRightAperture, mirroredFace, 'right', 0.5, 24)
  equal(
    mirroredLeftAperture.topLeft,
    mirroredRightAperture.topRight,
    `${emotion} eyelids should mirror their outer top edges`,
  )
  equal(
    mirroredLeftAperture.topRight,
    mirroredRightAperture.topLeft,
    `${emotion} eyelids should mirror their inner top edges`,
  )
}

const blendedFace = createFaceState()
const blendedAperture = createEyelidAperture()
const angryWeights = createEmotionWeights(Emotion.ANGRY)
blendedFace.emotion = Emotion.HAPPY
writeEmotionTransition(blendedFace, angryWeights, Emotion.HAPPY, 0)
writeEyelidAperture(blendedAperture, blendedFace, 'left', 0.5, 40)
const angryTopLeft = blendedAperture.topLeft
const angryBottom = blendedAperture.bottomLeft
writeEmotionTransition(blendedFace, angryWeights, Emotion.HAPPY, 0.5)
writeEyelidAperture(blendedAperture, blendedFace, 'left', 0.5, 40)
const midpointTopLeft = blendedAperture.topLeft
const midpointBottom = blendedAperture.bottomLeft
writeEmotionTransition(blendedFace, angryWeights, Emotion.HAPPY, 1)
writeEyelidAperture(blendedAperture, blendedFace, 'left', 0.5, 40)
equal(
  midpointTopLeft,
  (angryTopLeft + blendedAperture.topLeft) / 2,
  'emotion blends should interpolate the shared upper-eyelid topology',
)
equal(
  midpointBottom,
  (angryBottom + blendedAperture.bottomLeft) / 2,
  'emotion blends should interpolate the shared lower-eyelid topology',
)
equal(blendedAperture.bottomLeft, 24, 'a happy half-open eyelid should lift its lower edge proportionally')

const neutralEyelidRevision = maskRevision(simpleLeftEyelid)
const angryFace = createFaceState()
angryFace.emotion = Emotion.ANGRY
angryFace.eyes.left.open = 0.5
applyFaceState(simpleFace, angryFace)
assert(
  maskRevision(simpleLeftEyelid) > neutralEyelidRevision,
  'standard eyelid mask should change for angry expression',
)

const angryEyelidRevision = maskRevision(simpleLeftEyelid)
const happyFace = createFaceState()
happyFace.emotion = Emotion.HAPPY
happyFace.eyes.left.open = 0.5
applyFaceState(simpleFace, happyFace)
assert(maskRevision(simpleLeftEyelid) > angryEyelidRevision, 'standard eyelid mask should change for happy expression')

const themedFace = createFaceState()
setColorRGB(themedFace.theme.primary, 0x12, 0x34, 0x56)
setColorRGB(themedFace.theme.secondary, 0x65, 0x43, 0x21)
const themedPalette = createFaceSkinPalette(0x123456, 0x654321)
;(simpleFace as PiuNode & { distribute?: (id: string, value: unknown) => void }).distribute?.(
  'onFaceSkin',
  themedPalette,
)
;(simpleFace as PiuNode & { distribute?: (id: string, value: unknown) => void }).distribute?.('onFaceState', themedFace)
equal(
  drawnMaskColor(simpleLeftIris),
  themedPalette.primaryColor,
  'standard iris should draw with an updated primary color',
)
equal(
  drawnMaskColor(simpleLeftEyelid),
  themedPalette.secondaryColor,
  'standard eyelid should draw with an updated secondary color',
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
assertMaskPort(dogLeftEyelid, 'DogFace eyelid should render through a Gray16 mask port')
assertMaskPort(dogLeftEyebrow, 'DogFace eyebrow should render through a local Gray16 mask port')
assertMaskPort(dogMouth, 'DogFace mouth should render through a local Gray16 mask port')
assertMaskPort(dogNose, 'DogFace nose should render through a local Gray16 mask port')
assert((dogLeftEyebrow.coordinates?.width ?? 320) < 100, 'DogFace eyebrow should use a local bounding box')
assert((dogMouth.coordinates?.width ?? 320) < 100, 'DogFace mouth should use a local bounding box')
assert((dogNose.coordinates?.width ?? 320) < 100, 'DogFace nose should use a local bounding box')
const idleDogEyebrowMask = drawnMask(dogLeftEyebrow)
const idleDogMouthMask = drawnMask(dogMouth)
assert(idleDogEyebrowMask, 'DogFace eyebrow should provide a mask while the eye is idle')
assert(idleDogMouthMask, 'DogFace mouth should provide a mask while the mouth is closed')
assert(
  coveredPixelCount(idleDogEyebrowMask as Gray16Mask) > 0,
  'DogFace eyebrow mask should contain visible pixels while the eye is idle',
)
assert(
  coveredPixelCount(idleDogMouthMask as Gray16Mask) > 0,
  'DogFace mouth mask should contain visible pixels while the mouth is closed',
)
equal(
  drawGrayArgumentCount(dogMouth, -122, -117, 320, 240),
  2,
  'Gray16 parts should draw their complete local mask when Piu supplies an unclipped dirty area',
)

const dogEyebrowSad = maskRevision(dogLeftEyebrow)
const dogMouthClosed = maskRevision(dogMouth)
const dogNoseClosed = maskRevision(dogNose)
const dogOpen = createFaceState()
dogOpen.emotion = Emotion.ANGRY
dogOpen.eyes.left.open = 0.2
dogOpen.mouth.open = 1
applyFaceState(dogFace, dogOpen)
assert(maskRevision(dogLeftEyebrow) > dogEyebrowSad, 'DogFace eyebrow should change with expression and eye open')
assert(maskRevision(dogMouth) > dogMouthClosed, 'DogFace mouth should change with mouth open')
assert(maskRevision(dogNose) > dogNoseClosed, 'DogFace nose should change with mouth open')

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
const initialMovingIrisRevision = maskRevision(movingLeftIris)
const initialMovingEyelidRevision = maskRevision(movingLeftEyelid)
let breathingMoved = false
let blinkChanged = false
let saccadeChanged = false
for (let i = 0; i < 220; i++) {
  movingBehavior.onTimeChanged?.(movingFace)
  breathingMoved ||= topOf(movingFace) !== initialMovingTop
  blinkChanged ||= maskRevision(movingLeftEyelid) !== initialMovingEyelidRevision
  saccadeChanged ||= maskRevision(movingLeftIris) !== initialMovingIrisRevision
}
assert(breathingMoved, 'default FaceBehavior should move the face container for breathing')
assert(blinkChanged, 'default FaceBehavior should change eyelid outlines for blinking')
assert(saccadeChanged, 'default FaceBehavior should update the iris mask for saccade')
equal(movingLeftIris.coordinates?.left, initialMovingIrisLeft, 'saccade should keep iris content coordinates fixed')
equal(movingLeftIris.coordinates?.top, initialMovingIrisTop, 'saccade should keep iris content coordinates fixed')

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
const initialAppDrivenEyelidRevision = maskRevision(appDrivenLeftEyelid)
const appDrivenBehavior = appDrivenFace.behavior as {
  onDisplaying?: (node: PiuNode) => void
  onTimeChanged?: (node: PiuNode) => void
}
appDrivenBehavior.onDisplaying?.(appDrivenFace)
appDrivenBehavior.onTimeChanged?.(appDrivenFace)
assert(appMotionTicks > 0, 'AppController-hosted FaceBehavior should retain custom motions after mounting')
assert(topOf(appDrivenFace) !== initialAppDrivenTop, 'AppController-hosted face should move for breathing')
assert(
  maskRevision(appDrivenLeftEyelid) !== initialAppDrivenEyelidRevision,
  'AppController-hosted face should update eyelid masks for blinking',
)
trace('ok\n')
