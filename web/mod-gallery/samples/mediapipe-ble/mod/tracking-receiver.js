import { Emotion } from 'face-state'
import { handPairFromTracking, parseTrackingPayload } from 'mediapipe-tracking-message'

export const TRACKING_TICK_MS = 100

const MOTION_DURATION_SECONDS = 0.12
const STALE_AFTER_MS = 1000

export class TrackingReceiver {
  #active = false
  #handsEffect
  #hasPendingHands = false
  #lastEmotion = undefined
  #lastReceivedAt = 0
  #pendingEmotion = undefined
  #pendingFaceParts = undefined
  #pendingHands = undefined
  #poseInFlight = false
  #posePending = false
  #received = false
  #robot
  #rotation = { y: 0, p: 0, r: 0 }

  constructor(robot, handsEffect) {
    this.#robot = robot
    this.#handsEffect = handsEffect
  }

  receive(payload, now = Date.now()) {
    const parsed = parseTrackingPayload(payload)
    if (!parsed) return false
    this.#rotation.y = parsed.face?.yaw ?? 0
    this.#rotation.p = parsed.face?.pitch ?? 0
    this.#posePending = true
    if (parsed.emotion !== undefined) this.#pendingEmotion = parsed.emotion
    if (parsed.faceParts !== undefined) this.#pendingFaceParts = parsed.faceParts
    if (parsed.hands !== undefined) {
      this.#pendingHands = parsed.hands
      this.#hasPendingHands = true
    }
    this.#received = true
    this.#lastReceivedAt = now
    return true
  }

  tick(now = Date.now()) {
    if (!this.#received) return
    if (now - this.#lastReceivedAt >= STALE_AFTER_MS) {
      this.#reset()
      return
    }
    if (!this.#active) {
      this.#active = true
      try {
        this.#robot.motion.setTorque(true).catch(this.#onTorqueFailed)
      } catch (error) {
        this.#active = false
        trace(`[mediapipe-ble] setTorque failed: ${String(error)}\n`)
      }
    }
    this.#applyMotion()
    this.#applyVisualUpdates()
  }

  #applyMotion() {
    if (this.#poseInFlight || !this.#posePending) return
    this.#poseInFlight = true
    this.#posePending = false
    try {
      // The public MOD motion capability completes through a Promise. Waiting
      // for an ignored callback would leave this slot occupied after one pose.
      this.#robot.motion
        .setPose({ rotation: { ...this.#rotation } }, MOTION_DURATION_SECONDS)
        .then(this.#onPoseApplied, this.#onPoseFailed)
    } catch (error) {
      this.#poseInFlight = false
      this.#posePending = true
      trace(`[mediapipe-ble] setPose failed: ${String(error)}\n`)
    }
  }

  #onPoseApplied = () => {
    this.#poseInFlight = false
    this.#applyMotion()
  }

  #onPoseFailed = (error) => {
    this.#poseInFlight = false
    this.#posePending = true
    trace(`[mediapipe-ble] setPose failed: ${String(error)}\n`)
  }

  #onTorqueFailed = (error) => {
    this.#active = false
    trace(`[mediapipe-ble] setTorque failed: ${String(error)}\n`)
  }

  #applyVisualUpdates() {
    const pendingEmotion = this.#pendingEmotion
    if (pendingEmotion !== undefined) {
      this.#pendingEmotion = undefined
      const nextEmotion = pendingEmotion === 'happy' ? Emotion.HAPPY : Emotion.NEUTRAL
      if (nextEmotion !== this.#lastEmotion) {
        this.#lastEmotion = nextEmotion
        this.#robot.face.setEmotion(nextEmotion)
      }
    }
    const pendingFaceParts = this.#pendingFaceParts
    if (pendingFaceParts !== undefined) {
      this.#pendingFaceParts = undefined
      this.#robot.face.setEyeOpen('left', pendingFaceParts.eyeOpen.left)
      this.#robot.face.setEyeOpen('right', pendingFaceParts.eyeOpen.right)
      this.#robot.face.setMouthOpen(pendingFaceParts.mouthOpen)
    }
    if (this.#hasPendingHands) {
      this.#hasPendingHands = false
      this.#handsEffect.delegate('onHandPoseChanged', handPairFromTracking(this.#pendingHands))
      this.#pendingHands = undefined
    }
  }

  #reset() {
    this.#active = false
    this.#received = false
    this.#posePending = false
    this.#pendingEmotion = undefined
    this.#pendingFaceParts = undefined
    this.#pendingHands = undefined
    this.#hasPendingHands = false
    try {
      this.#robot.motion
        .setTorque(false)
        .catch((error) => trace(`[mediapipe-ble] torque release failed: ${String(error)}\n`))
    } catch (error) {
      trace(`[mediapipe-ble] torque release failed: ${String(error)}\n`)
    }
    if (this.#lastEmotion !== Emotion.NEUTRAL) {
      this.#lastEmotion = Emotion.NEUTRAL
      this.#robot.face.setEmotion(Emotion.NEUTRAL)
    }
    this.#robot.face.setEyeOpen('left', 1)
    this.#robot.face.setEyeOpen('right', 1)
    this.#robot.face.setMouthOpen(0)
    this.#handsEffect.delegate('onHandPoseChanged', {})
  }
}
