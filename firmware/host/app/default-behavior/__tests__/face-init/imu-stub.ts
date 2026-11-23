export type MotionType = 'shake' | 'fallenForward' | 'fallenBackward' | 'fallenLeft' | 'fallenRight' | 'upsideDown'
export default class IMU {
  onMotion?: (event: { type: MotionType }) => void
  start(): void {}
  stop(): void {}
}
