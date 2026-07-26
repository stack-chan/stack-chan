import { Emotion, emotionWeight, type FaceEyeKey, type FaceState } from 'face-state'

export type EyelidAperture = {
  topLeft: number
  topRight: number
  bottomLeft: number
  bottomRight: number
}

export function createEyelidAperture(): EyelidAperture {
  return {
    topLeft: 0,
    topRight: 0,
    bottomLeft: 0,
    bottomRight: 0,
  }
}

function clampUnit(value: number): number {
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}

/**
 * Resolves every expression to the same four-edge aperture topology. Blending
 * these edges keeps eyelids continuous even when HAPPY adds a lower lid.
 */
export function writeEyelidAperture(
  output: EyelidAperture,
  face: Readonly<FaceState>,
  side: FaceEyeKey,
  openValue: number,
  height: number,
): void {
  const open = clampUnit(openValue)
  const closed = height * (1 - open)
  const sloped = (height + closed) / 2
  const neutralWeight =
    emotionWeight(face, Emotion.NEUTRAL) +
    emotionWeight(face, Emotion.DOUBTFUL) +
    emotionWeight(face, Emotion.COLD) +
    emotionWeight(face, Emotion.HOT)
  const angryWeight = emotionWeight(face, Emotion.ANGRY)
  const sadWeight = emotionWeight(face, Emotion.SAD)
  const happyWeight = emotionWeight(face, Emotion.HAPPY)
  const sleepyWeight = emotionWeight(face, Emotion.SLEEPY)

  let angryLeft = sloped
  let angryRight = closed
  if (side === 'left') {
    angryLeft = closed
    angryRight = sloped
  }
  const sadLeft = angryRight
  const sadRight = angryLeft
  const neutralTop = closed
  const sleepyTop = height * (1 - open * 0.5)
  const happyTop = height * 0.6 * (1 - open)
  const happyBottom = height * 0.6

  output.topLeft =
    neutralTop * neutralWeight +
    angryLeft * angryWeight +
    sadLeft * sadWeight +
    happyTop * happyWeight +
    sleepyTop * sleepyWeight
  output.topRight =
    neutralTop * neutralWeight +
    angryRight * angryWeight +
    sadRight * sadWeight +
    happyTop * happyWeight +
    sleepyTop * sleepyWeight
  output.bottomLeft = height * (1 - happyWeight) + happyBottom * happyWeight
  output.bottomRight = output.bottomLeft
}
