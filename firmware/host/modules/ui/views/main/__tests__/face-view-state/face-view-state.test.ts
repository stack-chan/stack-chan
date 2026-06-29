import { AppController } from 'app-controller'
import { FaceBehavior } from 'behaviors/face'
import { createFaceState, type FaceState, setColorRGB, toPiuColorNumber } from 'face-state'
import { Application, Container, Content, type Container as PiuContainer } from 'piu/MC'
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

const application = new Application(
  {
    face: new TestFace({}),
  },
  {
    displayListLength: 2047,
    contents: [],
    Behavior: AppController,
  },
)

const controller = application.behavior as AppController
const desired = createFaceState()
setColorRGB(desired.theme.primary, 0x22, 0x55, 0xaa)
setColorRGB(desired.theme.secondary, 0xdd, 0xee, 0xff)
controller.update(32, desired)

const nextFace = new TestFace({}) as PiuContainer
controller.setFace(nextFace)

const recorder = nextFace.first as RecorderContent
const expectedPrimary = toPiuColorNumber(desired.theme.primary)
equal(recorder.skinPrimary, expectedPrimary, 'setFace should apply the active palette')
equal(recorder.contextPrimary, expectedPrimary, 'setFace should apply the active context')

const faceBehavior = nextFace.behavior as FaceBehavior
const skinHitsBeforeDisplaying = recorder.skinHits ?? 0
faceBehavior.onDisplaying(nextFace)
equal(recorder.contextPrimary, expectedPrimary, 'onDisplaying should keep the rehydrated context')
assert((recorder.skinHits ?? 0) > skinHitsBeforeDisplaying, 'onDisplaying should replay the cached palette')

const skinHitsBeforeResume = recorder.skinHits ?? 0
faceBehavior.pause(nextFace)
faceBehavior.resume(nextFace)
equal(recorder.contextPrimary, expectedPrimary, 'resume should keep the rehydrated context')
assert((recorder.skinHits ?? 0) > skinHitsBeforeResume, 'resume should replay the cached palette')

const recorderBehavior = recorder.behavior as RecorderBehavior
assert(typeof recorderBehavior.onFaceState === 'function', 'recorder should receive face context events')
assert(typeof recorderBehavior.onFaceSkin === 'function', 'recorder should receive face skin events')

trace('ok\n')
