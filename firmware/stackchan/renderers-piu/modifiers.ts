import { normRand, quantize, randomBetween } from 'stackchan-util'
import type { FaceContext } from './face-context'

export type FaceModifier = (tickMillis: number, face: FaceContext) => void
export type FaceModifierFactory<T> = (param: T) => FaceModifier

function linearInEaseOut(fraction: number): number {
  if (fraction < 0.25) return 1 - fraction * 4
  return ((fraction - 0.25) ** 2 * 16) / 9
}

export const createBlinkModifier: FaceModifierFactory<{
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

export const createSaccadeModifier: FaceModifierFactory<{
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

export const createBreathModifier: FaceModifierFactory<{
  duration: number
}> = ({ duration }) => {
  let time = 0
  return (tickMillis, face) => {
    time = (time + tickMillis) % duration
    face.breath = quantize(Math.sin((2 * Math.PI * time) / duration), 8)
  }
}
