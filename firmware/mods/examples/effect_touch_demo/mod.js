import { SimpleFace } from 'behaviors/face'
import { Emoticon } from 'effects/emoticon'
import { MusicNotes } from 'effects/music-notes'
import { Emotion } from 'face-state'
import { defineMod } from 'mod-kit'

const stages = [
  { key: 'heart', emotion: Emotion.HAPPY, mouth: 0.18 },
  { key: 'angry', emotion: Emotion.ANGRY, mouth: 0.08 },
  { key: 'sweat', emotion: Emotion.HOT, mouth: 0.24 },
  { key: 'tear', emotion: Emotion.SAD, mouth: 0.12 },
  { key: 'sleepy', emotion: Emotion.SLEEPY, mouth: 0.03 },
  { key: 'gloom', emotion: Emotion.DOUBTFUL, mouth: 0.06 },
  { key: 'music', emotion: Emotion.NEUTRAL, mouth: 0.38 },
]

export const { onContextCreated, onClose } = defineMod({
  setup(robot, _option, scope) {
    const touch = robot.input.touch
    const previousHandler = touch?.onEvent
    let stageIndex = 0
    let touchId = null
    let activeEffect = null

    function showStage() {
      const { key, emotion, mouth } = stages[stageIndex]
      if (activeEffect) robot.ui.removeEffect(activeEffect)
      activeEffect = key === 'music' ? new MusicNotes() : new Emoticon({ key })
      robot.ui.addEffect(activeEffect)
      robot.face.setEmotion(emotion)
      robot.face.setMouthOpen(mouth, true)
      trace(`[effect-touch-demo] stage=${stageIndex + 1}/${stages.length} key=${key}\n`)
    }

    function onTouch({ id, phase }) {
      if (phase === 'began' && touchId === null) {
        touchId = id
      } else if (phase === 'ended' && id === touchId) {
        touchId = null
        stageIndex = (stageIndex + 1) % stages.length
        showStage()
      }
    }

    scope.own(() => {
      if (touch?.onEvent === onTouch) touch.onEvent = previousHandler
      if (activeEffect) robot.ui.removeEffect(activeEffect)
    })

    robot.ui.setFace(new SimpleFace({}))
    showStage()
    if (touch) touch.onEvent = onTouch
    trace(`[effect-touch-demo] ready touch=${Boolean(touch)}\n`)
  },
})
