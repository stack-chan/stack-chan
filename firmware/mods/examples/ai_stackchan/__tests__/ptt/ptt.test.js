import { onClose, onContextCreated } from 'ai-mod'
import { state as defaults } from 'app-default-behavior'
import { Application } from 'piu/MC'
import { VoiceScope, state as voice } from 'stackchan/voice'
import { state as speech } from 'stackchan/voice/speech'
import { assert, equal } from 'testing/assert'
import Timer from 'timer'

const app = new Application(null, { width: 320, height: 240 })
const settle = () => new Promise((resolve) => Timer.set(resolve, 1))
const menus = new Map()
const balloons = []
let visibleBalloon
let mouth = 1
const mouthUpdates = []
const robot = {
  input: {},
  audio: { microphone: {}, speaker: {}, volume: 0.1 },
  face: {
    setEmotion() {},
    setMouthOpen(value) {
      mouth = value
      mouthUpdates.push({ value, time: Date.now() })
    },
  },
  ui: {
    faceMotionEnabled: true,
    setFaceMotionEnabled(enabled) {
      this.faceMotionEnabled = enabled
    },
    addEffect(effect) {
      app.add(effect)
    },
    removeEffect(effect) {
      if (effect.container) app.remove(effect)
    },
    closeDrawer() {},
    showBalloon(message) {
      balloons.push(message)
      visibleBalloon = message
    },
    hideBalloon() {
      visibleBalloon = undefined
    },
    drawer: {
      addDrawerButton(item) {
        menus.set(item.key, item)
      },
      removeDrawerButton(key) {
        menus.delete(key)
      },
    },
  },
}
const options = { config: { ai: { token: 'test' } } }
function finishTranscript(text = 'hello') {
  voice.pipeline.onEvent({ type: 'input.transcript', value: { final: true, text } })
}
function startTurn(turnId) {
  finishTranscript()
  voice.pipeline.onEvent({ type: 'turn.started', turnId })
}
onContextCreated(robot, options)
equal(defaults.calls, 1)
assert(menus.has('settings'))
const touch = app.first
equal(touch.name, 'ai-push-to-talk')
await settle()
assert(touch.y >= 56 && touch.x > 24, 'PTT leaves edge gestures accessible')
assert(touch.y + touch.height <= app.height - 32, 'PTT leaves the bottom gesture edge accessible')
screen.context.onTouchBegan(0, touch.x + 10, touch.y + 10, 0)
await settle()
equal(voice.presses, 1)
touch.behavior.onTouchBegan(touch, 1, touch.x + 10, touch.y + 10, 1)
touch.behavior.onTouchEnded(touch, 1)
equal(voice.releases, 0)
let releasePresentation
voice.onRelease = () => {
  releasePresentation = { motions: robot.ui.faceMotionEnabled, mouth, effects: app.length }
}
screen.context.onTouchEnded(0, touch.x + 10, touch.y + 10, 1)
voice.onRelease = undefined
equal(voice.releases, 1)
equal(releasePresentation.motions, false, 'face motions stop before transcription can start')
equal(releasePresentation.mouth, 0, 'communication starts with a closed mouth')
equal(releasePresentation.effects, 1, 'communication removes animated effects and keeps PTT')
assert(touch.active && touch.container === app, 'PTT remains usable during communication')
startTurn('one')
voice.pipeline.onEvent({ type: 'turn.ended', turnId: 'one', status: 'completed' })
equal(robot.ui.faceMotionEnabled, true, 'completed turn restores face motions')
touch.behavior.onTouchBegan(touch, 0, touch.x + 10, touch.y + 10, 2)
await settle()
touch.behavior.onTouchCancelled(touch, 0)
equal(voice.releases, 2)
startTurn('two')
voice.pipeline.onEvent({ type: 'turn.ended', turnId: 'two', status: 'interrupted' })
equal(robot.ui.faceMotionEnabled, true, 'interrupted turn restores face motions')
touch.behavior.onTouchBegan(touch, 0, touch.x + 10, touch.y + 10, 3)
await settle()
await menus.get('ai-end-conversation').callback()
equal(voice.releases, 3)
equal(voice.closes, 1)
touch.behavior.onTouchEnded(touch, 0)
touch.behavior.onTouchBegan(touch, 0, touch.x + 10, touch.y + 10, 4)
await settle()
equal(voice.starts, 2)
equal(voice.presses, 4)
await onClose()
equal(voice.releases, 4)
assert(!touch.container && !touch.active, 'close detaches and disables PTT')
equal(app.length, 0)
equal(voice.closes, 2)
assert(!menus.has('ai-end-conversation'))
await onClose()

const previous = () => {}
robot.input.button = { a: { onEvent: previous } }
onContextCreated(robot, options)
equal(app.length, 0)
robot.input.button.a.onEvent({ pressed: true })
await settle()
equal(voice.presses, 5)
robot.input.button.a.onEvent({ pressed: false })
equal(voice.releases, 5)
await onClose()
equal(robot.input.button.a.onEvent, defaults.handler)
equal(defaults.calls, 2)
equal(robot.ui.faceMotionEnabled, true, 'shutdown during transcription restores face motions')

robot.input.button = {}
onContextCreated(robot, options)
const pendingTouch = app.first
pendingTouch.behavior.onTouchBegan(pendingTouch, 0, pendingTouch.x + 1, pendingTouch.y + 1, 4)
await onClose()
await settle()
equal(voice.presses, 5, 'closing during startup cannot begin recording')
equal(app.length, 0)

robot.input.button = { a: {} }
onContextCreated(robot, options)
async function utterance() {
  robot.input.button.a.onEvent({ pressed: true })
  await settle()
  robot.input.button.a.onEvent({ pressed: false })
}
await utterance()
startTurn('old')
await utterance()
voice.pipeline.onEvent({ type: 'turn.ended', turnId: 'old', status: 'interrupted' })
equal(robot.ui.faceMotionEnabled, false, 'old turn completion cannot animate during the next transcription')
equal(app.length, 0, 'barge-in does not add animated effects during communication')
startTurn('new')
voice.pipeline.onEvent({ type: 'turn.ended', turnId: 'new', status: 'completed' })
equal(robot.ui.faceMotionEnabled, true)

await utterance()
await utterance()
startTurn('queued-one')
voice.pipeline.onEvent({ type: 'turn.ended', turnId: 'queued-one', status: 'interrupted' })
equal(robot.ui.faceMotionEnabled, false, 'each released input keeps communication quiet until handled')
startTurn('queued-two')
voice.pipeline.onEvent({ type: 'turn.ended', turnId: 'queued-two', status: 'completed' })
equal(robot.ui.faceMotionEnabled, true)

await utterance()
await utterance()
finishTranscript('superseded')
finishTranscript('latest')
equal(robot.ui.faceMotionEnabled, false, 'final transcript stays quiet until its turn starts')
voice.pipeline.onEvent({ type: 'turn.started', turnId: 'latest-only' })
voice.pipeline.onEvent({ type: 'turn.ended', turnId: 'latest-only', status: 'completed' })
equal(robot.ui.faceMotionEnabled, true, 'superseded transcript does not require a turn to restore animation')

await utterance()
await utterance()
finishTranscript('superseded')
finishTranscript('')
equal(robot.ui.faceMotionEnabled, true, 'latest empty transcript retires a superseded pending turn')

await utterance()
await utterance()
voice.pipeline.onEvent({ type: 'error', code: 'provider_failed', fatal: false })
equal(robot.ui.faceMotionEnabled, false, 'failed transcription cannot animate during the next queued input')
equal(visibleBalloon, undefined, 'communication stays free of error balloons while another input remains')
startTurn('after-input-error')
voice.pipeline.onEvent({ type: 'turn.ended', turnId: 'after-input-error', status: 'completed' })
equal(robot.ui.faceMotionEnabled, true, 'remaining input completion restores face motions')

await utterance()
robot.input.button.a.onEvent({ pressed: true })
await settle()
const releasesBeforeError = voice.releases
voice.pipeline.onEvent({ type: 'error', code: 'provider_failed', fatal: false })
equal(voice.releases, releasesBeforeError + 1, 'error releases the newer held recording')
equal(robot.ui.faceMotionEnabled, false, 'forced release stays quiet after an earlier input fails')
startTurn('forced-release')
voice.pipeline.onEvent({ type: 'turn.ended', turnId: 'forced-release', status: 'completed' })
equal(robot.ui.faceMotionEnabled, true)

await utterance()
startTurn('failed-turn')
await utterance()
voice.pipeline.onEvent({ type: 'error', code: 'provider_failed', fatal: false })
voice.pipeline.onEvent({ type: 'turn.ended', turnId: 'failed-turn', status: 'failed' })
equal(robot.ui.faceMotionEnabled, false, 'agent failure does not retire a queued transcription')
startTurn('after-turn-error')
voice.pipeline.onEvent({ type: 'turn.ended', turnId: 'after-turn-error', status: 'completed' })
equal(robot.ui.faceMotionEnabled, true)

await utterance()
voice.pipeline.onEvent({ type: 'input.transcript', value: { final: true, text: ' ' } })
equal(robot.ui.faceMotionEnabled, true, 'empty transcription restores face motions without a turn')
await utterance()
voice.pipeline.onEvent({ type: 'error', code: 'provider_failed', fatal: false })
equal(robot.ui.faceMotionEnabled, true, 'provider error restores face motions')
equal(balloons.pop(), '音声対話: provider_failed')
equal(visibleBalloon, '音声対話: provider_failed')

await utterance()
equal(visibleBalloon, undefined, 'new communication hides the previous error balloon')
const failedPipeline = voice.pipeline
voice.pipeline.onEvent({ type: 'error', code: 'resource_exhausted', fatal: true })
equal(robot.ui.faceMotionEnabled, true, 'fatal error restores face motions')
await settle()
await utterance()
startTurn('restarted')
voice.pipeline.onEvent({ type: 'turn.ended', turnId: 'restarted', status: 'completed' })
failedPipeline.onEvent({ type: 'turn.started', turnId: 'stale' })
equal(robot.ui.faceMotionEnabled, true, 'closed pipeline callbacks cannot change presentation')

robot.ui.setFaceMotionEnabled(false)
await utterance()
startTurn('disabled')
voice.pipeline.onEvent({ type: 'turn.ended', turnId: 'disabled', status: 'completed' })
equal(robot.ui.faceMotionEnabled, false, 'previously disabled animations stay disabled')
robot.ui.setFaceMotionEnabled(true)
await utterance()
let releaseClose
voice.onClose = () => new Promise((resolve) => (releaseClose = resolve))
const ending = menus.get('ai-end-conversation').callback()
equal(robot.ui.faceMotionEnabled, false, 'ending remains quiet until pipeline close settles')
releaseClose()
await ending
voice.onClose = undefined
equal(robot.ui.faceMotionEnabled, true, 'ending restores face motions after cleanup')

await utterance()
const lastPipeline = voice.pipeline
await onClose()
lastPipeline.onEvent({ type: 'turn.started', turnId: 'late' })
equal(robot.ui.faceMotionEnabled, true, 'late callbacks after shutdown cannot disable animation')
equal(mouth, 0)
equal(app.length, 0)
const pause = (ms) => new Promise((resolve) => Timer.set(resolve, ms))
onContextCreated(robot, options)
await utterance()
startTurn('lips')
const synthesisScope = VoiceScope.create()
const synthesis = await voice.tts.open({ signal: synthesisScope.signal })
const output = synthesis.output
await synthesis.write('hello')
equal(synthesis.output, output, 'wrapping preserves the synthesis source')
let mark = mouthUpdates.length
await pause(120)
equal(mouthUpdates.length, mark, 'waiting for synthesis does not animate the mouth')
let finishSpeech
speech.onFinish = () =>
  new Promise((resolve) => {
    finishSpeech = resolve
  })
const finishing = synthesis.endInput()
mark = mouthUpdates.length
await pause(350)
const frames = mouthUpdates.slice(mark)
assert(
  frames.some(({ value }) => value > 0),
  'synthesis moves only the mouth',
)
assert(frames.length >= 1 && frames.length <= 4, 'lip movement is limited to about ten frames per second')
for (let i = 1; i < frames.length; i++)
  assert(frames[i].time - frames[i - 1].time >= 90, 'lip frames are spaced by 100 ms')
equal(robot.ui.faceMotionEnabled, false, 'breathing and blinking remain disabled while lips move')
equal(app.length, 0, 'lip movement does not add decorative effects')
finishSpeech()
await finishing
speech.onFinish = undefined
mark = mouthUpdates.length
await pause(150)
assert(mouthUpdates.length > mark, 'lip movement continues while playback drains')
await synthesis.close()
equal(mouth, 0, 'synthesis close shuts the mouth')
mark = mouthUpdates.length
await pause(220)
equal(mouthUpdates.length, mark, 'closed synthesis leaves no mouth timer')
voice.pipeline.onEvent({ type: 'turn.ended', turnId: 'lips', status: 'completed' })
equal(robot.ui.faceMotionEnabled, true)

await utterance()
startTurn('lip-failure')
const broken = await voice.tts.open({ signal: VoiceScope.create().signal })
speech.onFinish = () => {
  throw new Error('synthesis failed')
}
assert(
  await broken.endInput().then(
    () => false,
    () => true,
  ),
)
speech.onFinish = undefined
equal(mouth, 0)
mark = mouthUpdates.length
await pause(220)
equal(mouthUpdates.length, mark, 'failed synthesis leaves no lip timer')
await broken.close()
voice.pipeline.onEvent({ type: 'error', code: 'provider_failed', fatal: false })
voice.pipeline.onEvent({ type: 'turn.ended', turnId: 'lip-failure', status: 'failed' })

await utterance()
startTurn('lip-cancel')
const cancelScope = VoiceScope.create()
const cancelled = await voice.tts.open({ signal: cancelScope.signal })
await cancelled.endInput()
await pause(120)
assert(mouth > 0)
cancelScope.abort()
equal(mouth, 0, 'scope cancellation immediately closes the mouth')
mark = mouthUpdates.length
await pause(220)
equal(mouthUpdates.length, mark, 'cancelled synthesis leaves no mouth timer')
voice.pipeline.onEvent({ type: 'turn.ended', turnId: 'lip-cancel', status: 'interrupted' })

await utterance()
startTurn('lip-end')
const endingSpeech = await voice.tts.open({ signal: VoiceScope.create().signal })
await endingSpeech.endInput()
await pause(120)
assert(mouth > 0)
await menus.get('ai-end-conversation').callback()
equal(mouth, 0, 'end conversation closes the mouth')
mark = mouthUpdates.length
await pause(220)
equal(mouthUpdates.length, mark, 'end conversation clears its lip timer')
await utterance()
startTurn('lip-new')
const newest = await voice.tts.open({ signal: VoiceScope.create().signal })
await newest.endInput()
await endingSpeech.close()
await pause(120)
assert(mouth > 0, 'late close from an old synthesis cannot stop the new mouth timer')
await onClose()
equal(mouth, 0)
mark = mouthUpdates.length
await pause(220)
equal(mouthUpdates.length, mark, 'shutdown leaves no delayed mouth update')
await newest.close()
await cancelled.close()
trace('@@STACKCHAN_TEST:PASS@@\n')
