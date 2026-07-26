import type { BorrowedAudioBuffer, OwnedAudioBuffer } from 'audio-buffer'
import type { RobotCamera } from 'camera'
import type { DrawerButtonViewSpec, DrawerOption, IconName } from 'drawer'
import type { Emotion, FaceEyeKey, FaceState, FaceThemeKey } from 'face-state'
import type { HandAnimationName } from 'hands'
import type IMU from 'imu'
import type { ButtonInputEvent } from 'input-event'
import type { LocalPeerCapability } from 'local-peer-types'
import type { I18nCapability } from 'localization'
import type { MiniAppRegistryCapability } from 'mini-app'
import type { MotionControllerPose, MotionDurationSeconds } from 'motion-controller'
import type { Container as PiuContainer, Content as PiuContent } from 'piu/MC'
import type { Maybe, Pose, Vector3 } from 'stackchan-util'
import type Touch from 'touch'
import type TouchPanel from 'touch-panel'
import type { TTSCompletion, TTSDoneListener, TTSPlaybackListener } from 'tts-types'

export type {
  JsonValue,
  LocalPeerBroadcastReceipt,
  LocalPeerCapability,
  LocalPeerDeliveryReceipt,
  LocalPeerErrorCode,
  LocalPeerInfo,
  LocalPeerMessage,
  LocalPeerOpenOptions,
  LocalPeerSession,
} from 'local-peer-types'
export { LocalPeerError } from 'local-peer-types'

export type TTS = {
  stream: (text: string, volume?: number, callback?: TTSCompletion) => void
  /** Streams raw stackchan-voice koe notation when the provider supports singing. */
  streamKoe?: (koe: string, volume?: number, callback?: TTSCompletion) => void
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

export type { I18nCapability } from 'localization'
export type { MiniAppContext, MiniAppDefinition, MiniAppInstance, MiniAppRegistryCapability } from 'mini-app'
export type { DrawerButtonViewSpec, DrawerOption }

export type RobotUI = {
  readonly miniApps: MiniAppRegistryCapability
  update: (interval: number, faceState: FaceState) => void
  addEffect(effect: UIEffect, key?: string): void
  removeEffect(effect: UIEffect): void
  application?: unknown
  setFace(face: PiuContainer): void
  /** Select one of the built-in hand animations shown around the face. */
  setHandAnimation(animation: HandAnimationName): void
  /** Enable or disable periodic face motions without replacing or hiding the current face. */
  setFaceMotionEnabled?(enabled: boolean): void
  /** Replace the swappable main component (e.g. a full-area dialog) while keeping AppBar/Drawer active. */
  setMain(content: PiuContainer): void
  /** Restore the face as the main component after a dialog was shown via setMain. */
  showFace(): void
  setDrawerButtons(buttons: DrawerButtonViewSpec[]): void
  addDrawerButton(button: DrawerButtonViewSpec): void
  removeDrawerButton(key: string): void
  setDrawerButtonState(key: string, active: boolean): void
  bindDrawerAction(key: string, callback: (value?: string) => void): boolean
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
  callback: (context: StackchanContext, value?: string) => unknown
  kind?: 'action' | 'choice' | 'swatch' | 'toggle'
  initialState?: boolean
  value?: string
  options?: DrawerOption[]
  icon?: IconName
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
  setEyeOpen(key: FaceEyeKey, value: number): void
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
  /** Sings raw koe notation. Returns a failure when the active TTS does not support singing. */
  sing(koe: string, volume?: number): Promise<Maybe<string>>
  record(durationMilliSec?: number): Promise<OwnedAudioBuffer>
  tone(hz: number, duration: number, volume?: number): Promise<void>
  /**
   * Attempts to play an audio buffer.
   * Returns true when playback completes, and false when playback is unsupported,
   * the buffer is empty, or playback fails.
   */
  playAudio(buffer: BorrowedAudioBuffer): Promise<boolean>
  /** Continuous MP3 streaming, available only on supported targets. */
  webRadio?: WebRadioCapability
}

export type WebRadioState = 'idle' | 'connecting' | 'buffering' | 'playing' | 'stalled' | 'retrying' | 'error'

export type WebRadioStartOptions = {
  url: string
  volume?: number
  sampleRate?: number
  reconnect?: boolean
  onStateChanged?: (state: WebRadioState, reason?: string) => void
}

export type WebRadioCapability = {
  readonly state: WebRadioState
  start(options: WebRadioStartOptions): Promise<void>
  stop(): void
  setVolume(volume: number): void
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

export type RemoteConversationState = 'standby' | 'connecting' | 'listening' | 'recognizing' | 'speaking' | 'blocked'
export type RemoteConversationTransportState = 'disconnected' | 'unsupported' | 'ready'

export type RemoteConversationSession = {
  readonly state: RemoteConversationState
  readonly lastError?: string
  readonly transportState: RemoteConversationTransportState
  requestStart(): string
  requestStop(): string
  subscribe(listener: (state: RemoteConversationState, error?: string) => void): () => void
  subscribeTransport(listener: (state: RemoteConversationTransportState) => void): () => void
}

export type ConversationCapability = {
  say(text: string, volume?: number): Promise<Maybe<string>>
  remoteSession?: RemoteConversationSession
}

export type NetworkReadyResult =
  | {
      status: 'connected'
    }
  | {
      status: 'skipped'
      reason: string
    }
  | {
      status: 'failed'
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
  /** Nearby peer messaging over a platform-supported transport such as ESP-NOW or BLE Serial. */
  localPeer?: LocalPeerCapability
}

export type LifecycleCapability = {
  /**
   * Releases resources owned by the app runtime context.
   * The method is idempotent and rejects only when an asynchronous owned resource fails to close.
   */
  close(): Promise<void>
}

export type BalloonTail = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

export type ShowBalloonOptions = {
  left?: number
  right?: number
  top?: number
  bottom?: number
  width?: number
  height?: number
  tail?: BalloonTail
}

export type RuntimeUICapability = RobotUI & {
  controller: RobotUI
  drawer: DrawerCapability
  showBalloon(text: string, option?: ShowBalloonOptions): void
  hideBalloon(): void
}

export type UICapability = {
  ui: RuntimeUICapability
  drawer: DrawerCapability
  showBalloon(text: string, option?: ShowBalloonOptions): void
  hideBalloon(): void
}

export type StackchanCapabilityNamespaces = {
  face: FaceCapability
  motion: MotionCapability
  audio: AudioCapability
  /**
   * Host-owned localization boundary for MOD UI. Keeping this on the context
   * lets the host select the locale and resolve installed MOD resources.
   */
  i18n: I18nCapability
  input: InputCapability
  lighting: LightingCapability
  camera: RobotCamera
  conversation: ConversationCapability
  connectivity: ConnectivityCapability
  lifecycle: LifecycleCapability
  ui: RuntimeUICapability
}

export type StackchanLegacyFlatCapability = FaceCapability &
  MotionCapability &
  AudioCapability &
  InputCapability &
  LightingCapability &
  CameraCapability &
  ConversationCapability &
  ConnectivityCapability &
  UICapability

export type StackchanContext = StackchanCapabilityNamespaces & StackchanLegacyFlatCapability
