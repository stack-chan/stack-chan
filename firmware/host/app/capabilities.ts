import type { BorrowedAudioBuffer, OwnedAudioBuffer } from 'audio-buffer'
import type { RobotCamera } from 'camera'
import type { Emotion, FaceState, FaceThemeKey } from 'face-state'
import type IMU from 'imu'
import type { ButtonInputEvent } from 'input-event'
import type { MotionControllerPose, MotionDurationSeconds } from 'motion-controller'
import type { Container as PiuContainer, Content as PiuContent } from 'piu/MC'
import type { Maybe, Pose, Vector3 } from 'stackchan-util'
import type Touch from 'touch'
import type TouchPanel from 'touch-panel'
import type { TTSCompletion, TTSDoneListener, TTSPlaybackListener } from 'tts-types'

export type TTS = {
  stream: (text: string, volume?: number, callback?: TTSCompletion) => void
  onPlayed?: TTSPlaybackListener
  onDone?: TTSDoneListener
}

export type UIEffect = PiuContent
export type RobotLed = {
  on(r: number, g: number, b: number, duration?: number, index?: number, count?: number): void
  off(index?: number, count?: number): void
  blink(r: number, g: number, b: number, duration: number, index?: number, count?: number): void
  rainbow(index?: number, count?: number): void
}

export type DrawerButtonViewSpec = {
  key: string
  label: string
  kind?: 'action' | 'toggle'
  active?: boolean
}

export type RobotUI = {
  update: (interval: number, faceState: FaceState) => void
  addEffect(effect: UIEffect, key?: string): void
  removeEffect(effect: UIEffect): void
  application?: unknown
  setFace(face: PiuContainer): void
  /** Replace the swappable main component (e.g. a full-area dialog) while keeping AppBar/Drawer active. */
  setMain(content: PiuContainer): void
  /** Restore the face as the main component after a dialog was shown via setMain. */
  showFace(): void
  setDrawerButtons(buttons: DrawerButtonViewSpec[]): void
  addDrawerButton(button: DrawerButtonViewSpec): void
  removeDrawerButton(key: string): void
  setDrawerButtonState(key: string, active: boolean): void
  bindDrawerAction(key: string, callback: () => void): boolean
  unbindDrawerAction(key: string): void
  openDrawer(): void
  closeDrawer(): void
  toggleDrawer(): void
}

export type Button = {
  onEvent?: (event: ButtonInputEvent) => void
}

export type DrawerButtonSpec = {
  key: string
  label: string
  callback: (context: StackchanContext) => unknown
  kind?: 'action' | 'toggle'
  initialState?: boolean
}

export type DrawerCapability = {
  addDrawerButton: (button: DrawerButtonSpec) => void
  removeDrawerButton: (key: string) => void
  clearDrawerButtons: () => void
  setDrawerButtonState: (key: string, active: boolean) => void
}

export type FaceCapability = {
  setColor(key: FaceThemeKey, r: number, g: number, b: number): void
  setEmotion(emotion: Emotion): void
  setMouthOpen(value: number): void
}

export type MotionCapability = {
  pose: MotionControllerPose
  lookAt(position: Vector3): void
  lookAway(): void
  setPose(pose: Pose, time?: MotionDurationSeconds): Promise<void>
  setTorque(torque: boolean): Promise<void>
}

export type AudioCapability = {
  tts: TTS
  microphone?: {
    record(durationMilliSec?: number): Promise<OwnedAudioBuffer>
  }
  /**
   * Replaces the TTS engine and rebinds playback lifecycle callbacks.
   * Prefer this namespaced API over the legacy flat `context.useTTS(...)` shim.
   */
  useTTS(tts: TTS): void
  say(text: string, volume?: number): Promise<Maybe<string>>
  record(durationMilliSec?: number): Promise<OwnedAudioBuffer>
  tone(hz: number, duration: number, volume?: number): Promise<void>
  /**
   * Attempts to play an audio buffer.
   * Returns true when playback completes, and false when playback is unsupported,
   * the buffer is empty, or playback fails.
   */
  playAudio(buffer: BorrowedAudioBuffer): Promise<boolean>
}

export type InputCapability = {
  button?: Partial<Record<'a' | 'b' | 'c' | 'power', Button>>
  /** Present only when the target platform exposes a screen touch driver as `config.Touch`. */
  touch?: Touch
  /** Present only when the target platform exposes a top touch-panel driver as `config.TouchPanel`. */
  touchPanel?: TouchPanel
  /** Present only when the target platform exposes an IMU through the device sensor environment. */
  imu?: IMU
}

export type LightingCapability = {
  led: Record<string, RobotLed>
  lightOn(ledName: string, r: number, g: number, b: number, duration?: number, index?: number, count?: number): void
  lightOff(ledName: string, index?: number, count?: number): void
  lightBlink(ledName: string, r: number, g: number, b: number, duration: number, index?: number, count?: number): void
  lightRainbow(ledName: string, index?: number, count?: number): void
}

export type CameraCapability = {
  camera: RobotCamera
}

export type ConversationCapability = {
  say(text: string, volume?: number): Promise<Maybe<string>>
}

export type NetworkReadyResult =
  | {
      status: 'connected'
    }
  | {
      status: 'skipped' | 'failed'
      reason: string
    }

export type NetworkCapability = {
  /**
   * Resolves when the host boot Wi-Fi attempt connects, is skipped because credentials are unavailable,
   * or fails with an observable reason.
   */
  ready: Promise<NetworkReadyResult>
}

export type ConnectivityCapability = {
  network?: NetworkCapability
}

export type LifecycleCapability = {
  /**
   * Releases resources owned by the app runtime context.
   * The method is idempotent and rejects only when an asynchronous owned resource fails to close.
   */
  close(): Promise<void>
}

export type RuntimeUICapability = RobotUI & {
  controller: RobotUI
  drawer: DrawerCapability
  showBalloon(
    text: string,
    option?: {
      left?: number
      right?: number
      top?: number
      bottom?: number
      width?: number
      height?: number
    },
  ): void
  hideBalloon(): void
}

export type UICapability = {
  ui: RuntimeUICapability
  drawer: DrawerCapability
  showBalloon(
    text: string,
    option?: {
      left?: number
      right?: number
      top?: number
      bottom?: number
      width?: number
      height?: number
    },
  ): void
  hideBalloon(): void
}

export type StackchanCapabilityNamespaces = {
  face: FaceCapability
  motion: MotionCapability
  audio: AudioCapability
  input: InputCapability
  lighting: LightingCapability
  camera: RobotCamera
  conversation: ConversationCapability
  connectivity: ConnectivityCapability
  lifecycle: LifecycleCapability
  ui: RuntimeUICapability
}

/**
 * @deprecated Use the namespaced capabilities on `StackchanContext` instead
 * (`context.face`, `context.motion`, `context.audio`, `context.input`,
 * `context.lighting`, `context.connectivity`, and `context.ui`).
 */
export type StackchanLegacyFlatCapability = {
  /** @deprecated Use `context.face.setColor(...)` instead. */
  setColor: FaceCapability['setColor']
  /** @deprecated Use `context.face.setEmotion(...)` instead. */
  setEmotion: FaceCapability['setEmotion']
  /** @deprecated Use `context.face.setMouthOpen(...)` instead. */
  setMouthOpen: FaceCapability['setMouthOpen']
  /** @deprecated Use `context.motion.pose` instead. */
  pose: MotionCapability['pose']
  /** @deprecated Use `context.motion.lookAt(...)` instead. */
  lookAt: MotionCapability['lookAt']
  /** @deprecated Use `context.motion.lookAway()` instead. */
  lookAway: MotionCapability['lookAway']
  /** @deprecated Use `context.motion.setPose(...)` instead. */
  setPose: MotionCapability['setPose']
  /** @deprecated Use `context.motion.setTorque(...)` instead. */
  setTorque: MotionCapability['setTorque']
  /** @deprecated Use `context.audio.tts` instead. */
  tts: AudioCapability['tts']
  /** @deprecated Use `context.audio.microphone` instead. */
  microphone?: AudioCapability['microphone']
  /** @deprecated Use `context.audio.useTTS(...)` instead. */
  useTTS: AudioCapability['useTTS']
  /** @deprecated Use `context.audio.say(...)` instead. */
  say: AudioCapability['say']
  /** @deprecated Use `context.audio.record(...)` instead. */
  record: AudioCapability['record']
  /** @deprecated Use `context.audio.tone(...)` instead. */
  tone: AudioCapability['tone']
  /** @deprecated Use `context.audio.playAudio(...)` instead. */
  playAudio: AudioCapability['playAudio']
  /** @deprecated Use `context.input.button` instead. */
  button?: InputCapability['button']
  /** @deprecated Use `context.input.touch` instead. */
  touch?: InputCapability['touch']
  /** @deprecated Use `context.input.touchPanel` instead. */
  touchPanel?: InputCapability['touchPanel']
  /** @deprecated Use `context.input.imu` instead. */
  imu?: InputCapability['imu']
  /** @deprecated Use `context.lighting.led` instead. */
  led: LightingCapability['led']
  /** @deprecated Use `context.lighting.lightOn(...)` instead. */
  lightOn: LightingCapability['lightOn']
  /** @deprecated Use `context.lighting.lightOff(...)` instead. */
  lightOff: LightingCapability['lightOff']
  /** @deprecated Use `context.lighting.lightBlink(...)` instead. */
  lightBlink: LightingCapability['lightBlink']
  /** @deprecated Use `context.lighting.lightRainbow(...)` instead. */
  lightRainbow: LightingCapability['lightRainbow']
  camera: CameraCapability['camera']
  /** @deprecated Use `context.connectivity.network` instead. */
  network?: ConnectivityCapability['network']
  ui: UICapability['ui']
  /** @deprecated Use `context.ui.drawer` instead. */
  drawer: RuntimeUICapability['drawer']
  /** @deprecated Use `context.ui.showBalloon(...)` instead. */
  showBalloon: RuntimeUICapability['showBalloon']
  /** @deprecated Use `context.ui.hideBalloon()` instead. */
  hideBalloon: RuntimeUICapability['hideBalloon']
}

export type StackchanContext = StackchanCapabilityNamespaces & StackchanLegacyFlatCapability
