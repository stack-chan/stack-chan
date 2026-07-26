import { FaceBase } from 'behaviors/face'
import {
  createEmotionWeights,
  Emotion,
  EmotionNames,
  type EmotionWeights,
  type FaceState,
  writeEmotionTransition,
} from 'face-state'
import { createBlinkMotion } from 'motions/blink'
import type { FaceMotion } from 'motions/types'
import { Eye } from 'parts/eye'
import { Mouth } from 'parts/mouth'
import { Application, Label, Skin, Style } from 'piu/MC'

const TICK_MS = 33
const SEGMENT_MS = 1800
const sequence = Object.freeze([
  Emotion.NEUTRAL,
  Emotion.ANGRY,
  Emotion.SAD,
  Emotion.HAPPY,
])
const sequenceWeights: readonly Readonly<EmotionWeights>[] = Object.freeze(
  sequence.map((emotion) => Object.freeze(createEmotionWeights(emotion))),
)

const background = new Skin({ fill: '#000000' })
const titleStyle = new Style({
  font: '16px Open Sans',
  color: '#ffffff',
  horizontal: 'center',
  vertical: 'middle',
})
const captionStyle = new Style({
  font: '16px Open Sans',
  color: '#a0a0a0',
  horizontal: 'center',
  vertical: 'middle',
})

function smoothstep(value: number): number {
  return value * value * (3 - 2 * value)
}

function createVisualMotion(): FaceMotion {
  let elapsedMs = 0
  let previousSegment = -1

  return (tickMs: number, face: FaceState) => {
    elapsedMs = (elapsedMs + tickMs) % (SEGMENT_MS * sequence.length)
    const segment = Math.floor(elapsedMs / SEGMENT_MS)
    const start = sequence[segment]
    const target = sequence[(segment + 1) % sequence.length]
    const progress = (elapsedMs % SEGMENT_MS) / SEGMENT_MS

    face.emotion = target
    writeEmotionTransition(face, sequenceWeights[segment], target, smoothstep(progress))
    face.eyes.left.open = 1
    face.eyes.right.open = 1
    face.eyes.left.gazeX = 0
    face.eyes.left.gazeY = 0
    face.eyes.right.gazeX = 0
    face.eyes.right.gazeY = 0
    face.mouth.open = 0.2 + 0.55 * Math.sin(progress * Math.PI)
    face.breath = 0

    if (segment === previousSegment) return
    previousSegment = segment
    trace(
      `[face-rendering-visual] ${EmotionNames[start]} -> ${EmotionNames[target]}\n`,
    )
  }
}

const face = new FaceBase({
  left: 0,
  top: 40,
  width: 320,
  height: 180,
  intervalMs: TICK_MS,
  motions: [
    createVisualMotion(),
    createBlinkMotion({ openMin: 400, openMax: 5000, closeMin: 200, closeMax: 400 }),
  ],
  contents: [
    new Eye({ cx: 82, cy: 64, radius: 8, side: 'left' }),
    new Eye({ cx: 238, cy: 64, radius: 16, side: 'right' }),
    new Mouth({
      cx: 160,
      cy: 125,
      minWidth: 32,
      maxWidth: 48,
      minHeight: 4,
      maxHeight: 30,
    }),
  ],
})

new Application(null, {
  displayListLength: 8192,
  skin: background,
  contents: [
    new Label(null, {
      left: 0,
      right: 0,
      top: 4,
      height: 28,
      string: 'emotion blend + blink',
      style: titleStyle,
    }),
    face,
    new Label(null, {
      left: 42,
      width: 80,
      bottom: 5,
      height: 24,
      string: 'iris r=8',
      style: captionStyle,
    }),
    new Label(null, {
      right: 34,
      width: 100,
      bottom: 5,
      height: 24,
      string: 'iris r=16',
      style: captionStyle,
    }),
  ],
})
