import type { FaceContext, FaceBehaviorFactory } from './piu-renderer-base'
import { randomBetween, normRand, quantize } from 'stackchan-util'

function linearInEaseOut(fraction: number): number {
  if (fraction < 0.25) {
    return 1 - fraction * 4
  }
  return ((fraction - 0.25) ** 2 * 16) / 9
}

export const createBlinkBehavior: FaceBehaviorFactory<{
  openMin: number
  openMax: number
  closeMin: number
  closeMax: number
}> = ({ openMin, openMax, closeMin, closeMax }) => {
  let isBlinking = false
  let nextToggle = randomBetween(openMin, openMax)
  let count = 0

  return {
    modify(faceContext: FaceContext, tickMillis: number) {
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
      faceContext.eyes.left.open *= eyeOpen
      faceContext.eyes.right.open *= eyeOpen
    },
  }
}

export const createSaccadeBehavior: FaceBehaviorFactory<{
  updateMin: number
  updateMax: number
  gain: number
}> = ({ updateMin, updateMax, gain }) => {
  let nextToggle = randomBetween(updateMin, updateMax)
  let saccadeX = 0
  let saccadeY = 0

  return {
    modify(faceContext: FaceContext, tickMillis: number) {
      nextToggle -= tickMillis
      if (nextToggle < 0) {
        saccadeX = normRand(0, gain)
        saccadeY = normRand(0, gain)
        nextToggle = randomBetween(updateMin, updateMax)
      }
      faceContext.eyes.left.gazeX += saccadeX
      faceContext.eyes.left.gazeY += saccadeY
      faceContext.eyes.right.gazeX += saccadeX
      faceContext.eyes.right.gazeY += saccadeY
    },
  }
}

export const createBreathBehavior: FaceBehaviorFactory<{
  duration: number
}> = ({ duration }) => {
  let time = 0

  return {
    modify(faceContext: FaceContext, tickMillis: number) {
      time = (time + tickMillis) % duration
      faceContext.breath = quantize(Math.sin((2 * Math.PI * time) / duration), 8)
    },
  }
}
