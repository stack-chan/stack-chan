import { onContextCreated } from 'app-default-behavior/on-context-created'
import { Emotion } from 'face-state'
import { equal } from 'testing/assert'
import Timer from 'timer'

const clock = Timer as typeof Timer & { reset(): void; advance(milliseconds: number): void }

type TouchEvent = { gesture: string; ticks: number }
type Button = { key: string; callback?: (target: unknown, value?: string) => void }

function createHarness(baseEmotion: Emotion = Emotion.NEUTRAL) {
  clock.reset()
  let emotion: Emotion = Emotion.NEUTRAL
  const effects = new Set<unknown>()
  const buttons: Button[] = []
  let touchListener: ((event: TouchEvent) => void) | undefined
  const imu = { start() {}, onEvent: (_event: { motion: string }) => {} }
  const robot = {
    drawer: { addDrawerButton: (button: Button) => buttons.push(button) },
    ui: {
      application: { distribute() {} },
      addEffect: (effect: unknown) => effects.add(effect),
      removeEffect: (effect: unknown) => effects.delete(effect),
      setHandAnimation() {},
    },
    pose: { body: { position: { x: 0, y: 0, z: 0 }, rotation: { y: 0, p: 0, r: 0 } } },
    camera: { available: false },
    led: {},
    lookAway() {},
    setEmotion: (value: Emotion) => {
      emotion = value
    },
    // Keep the simulated petting motion pending; these tests exercise emotion
    // timers without running a motion sequence or opening any hardware.
    setTorque: () => new Promise<void>(() => {}),
    setPose: () => new Promise<void>(() => {}),
    imu,
    touchPanel: {
      subscribe: (listener: (event: TouchEvent) => void) => {
        touchListener = listener
      },
    },
  }
  onContextCreated?.(robot as never, { config: { ui: { type: 'simple' } } } as never)
  const selectEmotion = (value: Emotion) => {
    buttons.find((button) => button.key === 'cycleEmotion')?.callback?.(robot, String(value))
  }
  selectEmotion(baseEmotion)
  return {
    get emotion() {
      return emotion
    },
    get effectCount() {
      return effects.size
    },
    motion: (motion = 'fallenLeft') => imu.onEvent({ motion }),
    pet: () => {
      touchListener?.({ gesture: 'forwardSwipe', ticks: 100 })
      touchListener?.({ gesture: 'backwardSwipe', ticks: 500 })
    },
    selectEmotion,
  }
}

for (const base of [Emotion.NEUTRAL, Emotion.SAD, Emotion.ANGRY, Emotion.HAPPY]) {
  const robot = createHarness(base)
  robot.motion()
  equal(robot.emotion, Emotion.ANGRY, 'falling should display anger')
  clock.advance(1000)
  robot.pet()
  equal(robot.emotion, Emotion.HAPPY, 'petting should temporarily replace anger with happiness')
  clock.advance(4000)
  equal(robot.emotion, Emotion.HAPPY, 'motion expiry should preserve the active petting reaction')
  clock.advance(1000)
  equal(robot.emotion, base, 'petting must not restore an expired motion reaction (#654)')
  equal(robot.effectCount, base === Emotion.NEUTRAL ? 0 : 1, 'expired effects must not remain on screen')
}

{
  const robot = createHarness()
  robot.pet()
  clock.advance(1000)
  robot.motion()
  clock.advance(4000)
  equal(robot.emotion, Emotion.ANGRY, 'petting expiry should preserve the newer motion reaction')
  clock.advance(1000)
  equal(robot.emotion, Emotion.NEUTRAL, 'motion must not restore expired petting happiness')
  equal(robot.effectCount, 0, 'both expired reactions should remove their effects')
}

{
  const robot = createHarness()
  robot.motion()
  clock.advance(1000)
  robot.pet()
  clock.advance(1000)
  robot.motion('shake')
  equal(robot.emotion, Emotion.HOT, 'a newer motion should replace the previous reaction')
  clock.advance(1000)
  robot.pet()
  clock.advance(2000)
  equal(robot.emotion, Emotion.HAPPY, 'the canceled first motion timer must not replace petting')
  clock.advance(2000)
  equal(robot.emotion, Emotion.HAPPY, 'motion expiry should leave the restarted petting reaction visible')
  clock.advance(1000)
  equal(robot.emotion, Emotion.NEUTRAL, 'alternating motion types and petting must not retain stale anger')
  equal(robot.effectCount, 0, 'nested reactions should release every temporary effect')
}

{
  const robot = createHarness()
  robot.pet()
  clock.advance(1000)
  robot.motion()
  clock.advance(1000)
  robot.pet()
  clock.advance(1000)
  robot.motion('upsideDown')
  clock.advance(4000)
  equal(robot.emotion, Emotion.SAD, 'petting expiry should retain the latest motion in a nested sequence')
  clock.advance(1000)
  equal(robot.emotion, Emotion.NEUTRAL, 'nested reactions in the reverse order must restore the base')
}

{
  const robot = createHarness()
  robot.motion()
  clock.advance(1000)
  robot.pet()
  clock.advance(1000)
  robot.pet()
  clock.advance(4000)
  equal(robot.emotion, Emotion.HAPPY, 'repeated petting should cancel the previous expiry timer')
  clock.advance(1000)
  equal(robot.emotion, Emotion.NEUTRAL, 'repeated petting must retain the original base emotion')
  equal(robot.effectCount, 0, 'repeated petting must not leave the anger effect behind')
}

{
  const robot = createHarness()
  robot.motion()
  robot.pet()
  robot.selectEmotion(Emotion.SLEEPY)
  clock.advance(10000)
  equal(robot.emotion, Emotion.SLEEPY, 'manual emotion selection should cancel overlapping reactions')
}

for (const [motion, selected] of [
  ['fallenLeft', Emotion.ANGRY],
  ['shake', Emotion.HOT],
  ['upsideDown', Emotion.SAD],
] as const) {
  const robot = createHarness()
  robot.motion(motion)
  clock.advance(1000)
  robot.selectEmotion(selected)
  clock.advance(1000)
  robot.pet()
  clock.advance(5000)
  equal(robot.emotion, selected, 'petting must preserve a manual selection matching the active motion emotion')
  clock.advance(5000)
  equal(robot.emotion, selected, 'expired motion timers must not overwrite the matching manual selection')
}

{
  const robot = createHarness(Emotion.SAD)
  robot.motion()
  clock.advance(5000)
  equal(robot.emotion, Emotion.SAD, 'a standalone motion should preserve its original restoration behavior')
  robot.motion('shake')
  clock.advance(5000)
  equal(robot.emotion, Emotion.SAD, 'a new motion after expiry should capture a fresh base')
}

{
  const robot = createHarness(Emotion.ANGRY)
  robot.pet()
  clock.advance(5000)
  equal(robot.emotion, Emotion.ANGRY, 'standalone petting should retain an intentionally selected anger emotion')
  robot.pet()
  clock.advance(5000)
  equal(robot.emotion, Emotion.ANGRY, 'a new petting reaction after expiry should retain its base')
}

trace('ok\n')
