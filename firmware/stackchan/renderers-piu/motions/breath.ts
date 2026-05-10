import { quantize } from 'stackchan-util'
import type { FaceMotionFactory } from 'motions/types'

export const createBreathMotion: FaceMotionFactory<{
  duration: number
}> = ({ duration }) => {
  let time = 0
  return (tickMillis, face) => {
    time = (time + tickMillis) % duration
    face.breath = quantize(Math.sin((2 * Math.PI * time) / duration), 8)
  }
}
