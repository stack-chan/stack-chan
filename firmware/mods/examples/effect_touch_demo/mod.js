import { SimpleFace } from 'behaviors/face'
import { Emoticon } from 'effects/emoticon'
import { MusicNotes } from 'effects/music-notes'
import { Emotion } from 'face-state'
import { defineMod } from 'mod-kit'
import { Content } from 'piu/MC'

const stages = [
  { key: 'heart', emotion: Emotion.HAPPY, mouth: 0.18 },
  { key: 'angry', emotion: Emotion.ANGRY, mouth: 0.08 },
  { key: 'sweat', emotion: Emotion.HOT, mouth: 0.24 },
  { key: 'tear', emotion: Emotion.SAD, mouth: 0.12 },
  { key: 'sleepy', emotion: Emotion.SLEEPY, mouth: 0.03 },
  { key: 'gloom', emotion: Emotion.DOUBTFUL, mouth: 0.06 },
  { key: 'music', emotion: Emotion.NEUTRAL, mouth: 0.38 },
]

class AdvanceOnTouch extends Behavior {
  #touchId = null
  #advance

  onCreate(_content, advance) {
    this.#advance = advance
  }

  onTouchBegan(content, id, x, y, ticks) {
    if (this.#touchId !== null) return
    this.#touchId = id
    content.captureTouch(id, x, y, ticks)
  }

  onTouchEnded(_content, id) {
    if (id !== this.#touchId) return
    this.#touchId = null
    this.#advance()
  }

  onTouchCancelled(_content, id) {
    if (id === this.#touchId) this.#touchId = null
  }
}

export const { onContextCreated, onClose } = defineMod({
  setup(robot, _option, scope) {
    let stageIndex = 0
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

    const touchSurface = new Content(
      () => {
        stageIndex = (stageIndex + 1) % stages.length
        showStage()
      },
      { left: 0, right: 0, top: 0, bottom: 0, active: true, Behavior: AdvanceOnTouch },
    )

    scope.own(() => {
      robot.ui.removeEffect(touchSurface)
      if (activeEffect) robot.ui.removeEffect(activeEffect)
    })

    robot.ui.setFace(new SimpleFace({}))
    showStage()
    robot.ui.addEffect(touchSurface)
    trace('[effect-touch-demo] ready input=piu\n')
  },
})
