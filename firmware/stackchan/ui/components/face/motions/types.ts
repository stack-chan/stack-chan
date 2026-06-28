import type { FaceContext } from 'face-context'

export type FaceMotion = (tickMillis: number, face: FaceContext) => void
export type FaceMotionFactory<T> = (param: T) => FaceMotion
