import type { FaceMotionFactory } from 'motions/types'
import { normRand, randomBetween } from 'stackchan-util'

export const createSaccadeMotion: FaceMotionFactory<{
  updateMin: number
  updateMax: number
  gain: number
}> = ({ updateMin, updateMax, gain }) => {
  let nextToggle = randomBetween(updateMin, updateMax)
  let saccadeX = 0
  let saccadeY = 0
  return (tickMillis, face) => {
    nextToggle -= tickMillis
    if (nextToggle < 0) {
      saccadeX = normRand(0, gain)
      saccadeY = normRand(0, gain)
      nextToggle = randomBetween(updateMin, updateMax)
    }
    const eyes = face.eyes
    eyes.left.gazeX += saccadeX
    eyes.left.gazeY += saccadeY
    eyes.right.gazeX += saccadeX
    eyes.right.gazeY += saccadeY
  }
}
