import type { DrawerButtonViewSpec } from 'drawer'
import type { FaceState } from 'face-state'
import type { HandAnimationName } from 'hands'
import type { LocalPeerCapability } from 'local-peer-types'
import type { MiniAppRegistryCapability } from 'mini-app'
import type { Container as PiuContainer, Content as PiuContent } from 'piu/MC'
import type { NetworkAvailability, NetworkReadyResult, NetworkState } from '../modules/connectivity/network-types.js'

export type { TTS } from 'tts-types'

export type UIEffect = PiuContent
export type RobotLed = {
  on(r: number, g: number, b: number, duration?: number, index?: number, count?: number): void
  off(index?: number, count?: number): void
  blink(r: number, g: number, b: number, duration: number, index?: number, count?: number): void
  rainbow(index?: number, count?: number): void
  close?(): void | Promise<void>
}

export type { DrawerButtonViewSpec }

export type RobotUI = {
  close?(): void | Promise<void>
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

/** Host-owned display access for the USB session. Never passed to an app. */
export type HostPresentation = {
  readonly ui: Pick<
    RobotUI,
    'application' | 'addEffect' | 'removeEffect' | 'setFaceMotionEnabled' | 'setMain' | 'showFace' | 'closeDrawer'
  >
  setMouthOpen(value: number): void
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

export type RemoteConversationState = 'standby' | 'connecting' | 'listening' | 'recognizing' | 'speaking' | 'blocked'
export type RemoteConversationTransportState = 'disconnected' | 'unsupported' | 'ready'
export type RemoteConversationActivationState = 'inactive' | 'active'
export type RemoteConversationListener = (state: RemoteConversationState, error?: string) => void
export type RemoteConversationTransportListener = (state: RemoteConversationTransportState) => void

export type RemoteConversationSessionDelegate = {
  readonly state: RemoteConversationState
  readonly lastError?: string
  readonly transportState: RemoteConversationTransportState
  requestStart(): string
  requestStop(): string
  subscribe(listener: RemoteConversationListener): () => void
  subscribeTransport(listener: RemoteConversationTransportListener): () => void
}

export type RemoteConversationSession = RemoteConversationSessionDelegate & {
  readonly activationState: RemoteConversationActivationState
  activate(): void
  deactivate(): void
}

export type { NetworkReadyResult } from '../modules/connectivity/network-types.js'

export type NetworkCapability = {
  readonly availability?: NetworkAvailability
  readonly state?: NetworkState
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
