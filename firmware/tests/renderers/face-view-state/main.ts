import { AppController } from 'app-controller'
import { FaceBehavior } from 'behaviors/face'
import { copyFaceContext, createFaceContext, defaultFaceContext, type FaceContext } from 'face-context'
import { assert, equal } from 'mocks/assert'
import { Application, Container, Content, type Container as PiuContainer } from 'piu/MC'

trace('=== face-view state test ===\n')

type RecorderContent = Content & {
  contextPrimary?: string
  skinPrimary?: string
  contextHits?: number
  skinHits?: number
}

type RecorderBehavior = {
  onFaceContext?: (content: RecorderContent, face: FaceContext) => void
  onFaceSkin?: (content: RecorderContent, palette: { primaryColor: string }) => void
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
          content.contextPrimary = ''
          content.skinPrimary = ''
          content.contextHits = 0
          content.skinHits = 0
        }

        onFaceContext(content: RecorderContent, face: FaceContext) {
          content.contextPrimary = face.theme.primary
          content.contextHits = (content.contextHits ?? 0) + 1
        }

        onFaceSkin(content: RecorderContent, palette: { primaryColor: string }) {
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
const desired = createFaceContext()
copyFaceContext(defaultFaceContext, desired)
desired.theme.primary = '#2255aa'
desired.theme.secondary = '#ddeeff'
controller.update(32, desired)

const nextFace = new TestFace({}) as PiuContainer
controller.setFace(nextFace)

const recorder = nextFace.first as RecorderContent
equal(recorder.skinPrimary, desired.theme.primary, 'setFace should apply the active palette')
equal(recorder.contextPrimary, desired.theme.primary, 'setFace should apply the active context')

const faceBehavior = nextFace.behavior as FaceBehavior
const skinHitsBeforeDisplaying = recorder.skinHits ?? 0
faceBehavior.onDisplaying(nextFace)
equal(recorder.contextPrimary, desired.theme.primary, 'onDisplaying should keep the rehydrated context')
assert((recorder.skinHits ?? 0) > skinHitsBeforeDisplaying, 'onDisplaying should replay the cached palette')

const skinHitsBeforeResume = recorder.skinHits ?? 0
faceBehavior.pause(nextFace)
faceBehavior.resume(nextFace)
equal(recorder.contextPrimary, desired.theme.primary, 'resume should keep the rehydrated context')
assert((recorder.skinHits ?? 0) > skinHitsBeforeResume, 'resume should replay the cached palette')

const recorderBehavior = recorder.behavior as RecorderBehavior
assert(typeof recorderBehavior.onFaceContext === 'function', 'recorder should receive face context events')
assert(typeof recorderBehavior.onFaceSkin === 'function', 'recorder should receive face skin events')

trace('ok\n')
