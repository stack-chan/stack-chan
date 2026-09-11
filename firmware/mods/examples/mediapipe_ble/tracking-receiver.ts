import type { AppContext } from 'stackchan'
import { type FaceTracking, ui } from 'stackchan/extensions/ui'
import { handPairFromTracking, parseTrackingPayload, type TrackingPayload } from './tracking-message'

export const TRACKING_TICK_MS = 100
export class TrackingReceiver {
  readonly #app: AppContext
  #lastReceived = 0
  #pending: TrackingPayload | undefined
  #received = false
  #face: FaceTracking = { leftEye: 1, rightEye: 1, mouth: 0, hands: {} }
  constructor(app: AppContext) {
    this.#app = app
  }
  receive(value: unknown, now = Date.now()): boolean {
    const payload = parseTrackingPayload(value)
    if (!payload) return false
    this.#pending = { ...this.#pending, ...payload }
    this.#received = true
    this.#lastReceived = now
    return true
  }
  async tick(now = Date.now()): Promise<void> {
    const app = this.#app
    if (!this.#received) return
    if (now - this.#lastReceived >= 1000) {
      this.#received = false
      this.#pending = undefined
      this.#face = { leftEye: 1, rightEye: 1, mouth: 0, hands: {} }
      ui(app).setTracking(null)
      app.face.setEmotion('neutral')
      await app.motion.relax()
      return
    }
    const value = this.#pending
    if (!value) return
    this.#pending = undefined
    if (value.emotion) app.face.setEmotion(value.emotion)
    if (value.faceParts)
      this.#face = {
        ...this.#face,
        leftEye: value.faceParts.eyeOpen.left,
        rightEye: value.faceParts.eyeOpen.right,
        mouth: value.faceParts.mouthOpen,
      }
    if (value.hands)
      this.#face = {
        ...this.#face,
        hands: Object.fromEntries(
          Object.entries(handPairFromTracking(value.hands)).map(([side, hand]) => [
            side,
            {
              shape: hand.shape,
              x: hand.pose.position.x,
              y: hand.pose.position.y,
              rotationDeg: (hand.pose.rotation.r * 180) / Math.PI,
            },
          ]),
        ),
      }
    ui(app).setTracking(this.#face)
    const info = app.motion.info
    if (info.availability === 'unavailable') return
    const yaw = ((value.face?.yaw ?? 0) * 180) / Math.PI,
      pitch = ((value.face?.pitch ?? 0) * 180) / Math.PI
    try {
      await app.motion.move(
        {
          yawDeg: Math.max(info.yawDeg[0], Math.min(info.yawDeg[1], yaw)),
          pitchDeg: Math.max(info.pitchDeg[0], Math.min(info.pitchDeg[1], pitch)),
        },
        { durationMs: 120 },
      )
    } catch (error) {
      this.#pending ??= value
      throw error
    }
  }
}
