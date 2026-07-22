import { Emotion } from 'face-state'
import { handPairFromTracking, parseTrackingPayload } from 'mediapipe-tracking-message'

const UPDATE_INTERVAL_SECONDS = 0.1
const STALE_AFTER_MS = 1000
const FILTER_WEIGHT = 0.5

function reportMotionFailure(operation, result) {
  result?.catch?.((error) => {
    trace(`[mediapipe-ble] ${operation} failed: ${String(error)}\n`)
  })
}

export class TrackingReceiver {
  #active = false
  #handsEffect
  #lastEmotion = undefined
  #lastReceivedAt = 0
  #latest = undefined
  #robot
  #rotation = { y: 0, p: 0, r: 0 }

  constructor(robot, handsEffect) {
    this.#robot = robot
    this.#handsEffect = handsEffect
  }

  receive(payload, now = Date.now()) {
    const parsed = parseTrackingPayload(payload)
    if (!parsed) return false
    this.#latest = parsed
    this.#lastReceivedAt = now
    return true
  }

  tick(now = Date.now()) {
    if (this.#latest) {
      const state = this.#latest
      this.#latest = undefined
      if (!this.#active) {
        this.#active = true
        try {
          reportMotionFailure('setTorque', this.#robot.motion.setTorque(true))
        } catch (error) {
          trace(`[mediapipe-ble] setTorque failed: ${String(error)}\n`)
        }
      }
      this.#apply(state)
      return
    }
    if (this.#active && now - this.#lastReceivedAt >= STALE_AFTER_MS) this.#reset()
  }

  #apply(state) {
    const face = state.face
    const targetYaw = face?.yaw ?? 0
    const targetPitch = face?.pitch ?? 0
    this.#rotation.y = this.#rotation.y * (1 - FILTER_WEIGHT) + targetYaw * FILTER_WEIGHT
    this.#rotation.p = this.#rotation.p * (1 - FILTER_WEIGHT) + targetPitch * FILTER_WEIGHT
    try {
      reportMotionFailure('setPose', this.#robot.motion.setPose({ rotation: this.#rotation }, UPDATE_INTERVAL_SECONDS))
    } catch (error) {
      trace(`[mediapipe-ble] setPose failed: ${String(error)}\n`)
    }

    const nextEmotion = face?.emotion === 'happy' ? Emotion.HAPPY : Emotion.NEUTRAL
    if (nextEmotion !== this.#lastEmotion) {
      this.#lastEmotion = nextEmotion
      this.#robot.face.setEmotion(nextEmotion)
    }
    this.#handsEffect.delegate('onHandPoseChanged', handPairFromTracking(state.hands))
  }

  #reset() {
    this.#active = false
    this.#rotation.y = 0
    this.#rotation.p = 0
    try {
      reportMotionFailure('neutral pose', this.#robot.motion.setPose({ rotation: this.#rotation }, 0.3))
    } catch (error) {
      trace(`[mediapipe-ble] neutral pose failed: ${String(error)}\n`)
    }
    if (this.#lastEmotion !== Emotion.NEUTRAL) {
      this.#lastEmotion = Emotion.NEUTRAL
      this.#robot.face.setEmotion(Emotion.NEUTRAL)
    }
    this.#handsEffect.delegate('onHandPoseChanged', {})
  }
}
