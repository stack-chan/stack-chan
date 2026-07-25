import type { FaceMotionFactory } from 'motions/types'
import { quantize } from 'stackchan-util'

export const createBreathMotion: FaceMotionFactory<{
  duration: number
}> = ({ duration }) => {
  let time = 0
  return (tickMillis, face) => {
    const rate = Number.isFinite(face.breathRate) ? Math.max(0, face.breathRate) : 1
    const amplitude = Number.isFinite(face.breathAmplitude) ? Math.max(0, face.breathAmplitude) : 1
    time = (time + tickMillis * rate) % duration
    face.breath = quantize(Math.sin((2 * Math.PI * time) / duration) * amplitude, 8)
  }
}
