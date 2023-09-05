import type { FaceContext, FaceModifierFactory } from 'renderer-base'
import { randomBetween, normRand, quantize } from 'stackchan-util'

function linearInEaseOut(fraction: number): number {
  if (fraction < 0.25) {
    return 1 - fraction * 4
  } else {
    return (Math.pow(fraction - 0.25, 2) * 16) / 9
  }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function linearInLinearOut(fraction: number): number {
  if (fraction < 0.5) {
    return 1 - fraction * 2
  } else {
    return fraction * 2 - 1
  }
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
  return (tickMillis: number, face: FaceContext) => {
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
    Object.values(face.eyes).map((eye) => {
      eye.open *= eyeOpen
    })
    return face
  }
}

export const createSaccadeModifier: FaceModifierFactory<{ updateMin: number; updateMax: number; gain: number }> = ({
  updateMin,
  updateMax,
  gain,
}) => {
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
    Object.values(face.eyes).map((eye) => {
      eye.gazeX += saccadeX
      eye.gazeY += saccadeY
    })
    return face
  }
}

export const createBreathModifier: FaceModifierFactory<{ duration: number }> = ({ duration }) => {
  let time = 0
  return (tickMillis, face) => {
    time += tickMillis % duration
    face.breath = quantize(Math.sin((2 * Math.PI * time) / duration), 8)
    return face
  }
}
