import type { FaceMotionFactory } from 'motions/types'
import { randomBetween } from 'stackchan-util'

function linearInEaseOut(fraction: number): number {
  if (fraction < 0.25) return 1 - fraction * 4
  return ((fraction - 0.25) ** 2 * 16) / 9
}

export const createBlinkMotion: FaceMotionFactory<{
  openMin: number
  openMax: number
  closeMin: number
  closeMax: number
}> = ({ openMin, openMax, closeMin, closeMax }) => {
  let isBlinking = false
  let nextToggle = randomBetween(openMin, openMax)
  let count = 0
  return (tickMillis, face) => {
    let eyeOpen = 1
    if (isBlinking) {
      const fraction = linearInEaseOut(count / nextToggle)
      eyeOpen = 0.2 + fraction * 0.8
    }
    count += tickMillis
    if (count >= nextToggle) {
      isBlinking = !isBlinking
      count = 0
      nextToggle = isBlinking ? randomBetween(closeMin, closeMax) : randomBetween(openMin, openMax)
    }
    const eyes = face.eyes
    eyes.left.open *= eyeOpen
    eyes.right.open *= eyeOpen
  }
}
