import type { FaceState } from 'face-state'

export type FaceMotion = (tickMillis: number, face: FaceState) => void
export type FaceMotionFactory<T> = (param: T) => FaceMotion
