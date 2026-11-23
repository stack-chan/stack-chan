export type { SpeechPlayback } from 'speech-playback-types'

import type { FaceState } from '../../ui/state/face-state.js'

export type * from '../../audio/media-types.js'

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

export type StackchanContext = unknown

export type RobotLed = {
  on(r: number, g: number, b: number, duration?: number, index?: number, count?: number): void
  off(index?: number, count?: number): void
  blink(r: number, g: number, b: number, duration: number, index?: number, count?: number): void
  rainbow(index?: number, count?: number): void
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

export type UIEffect = { behavior?: unknown }
export type DrawerOption = {
  value: string
  label: string
  swatch?: string
}
export type DrawerButtonViewSpec = {
  key: string
  label: string
  kind?: 'action' | 'choice' | 'swatch' | 'toggle'
  value?: string
  options?: DrawerOption[]
  icon?: string
}
export type DrawerButtonSpec = DrawerButtonViewSpec & {
  callback: (context: StackchanContext, value?: string) => unknown
  initialState?: boolean
}
export type DrawerCapability = {
  addDrawerButton: (button: DrawerButtonSpec) => void
  removeDrawerButton: (key: string) => void
  clearDrawerButtons: () => void
  setDrawerButtonState: (key: string, active: boolean) => void
}
export type ShowBalloonOptions = {
  left?: number
  right?: number
  top?: number
  bottom?: number
  width?: number
  height?: number
  tail?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
}
export type MainScreenOptions = {
  onClose?: () => void
}
export type RobotUI = {
  readonly miniApps: { register: (...args: unknown[]) => () => void }
  update: (interval: number, faceState: FaceState) => void
  addEffect(effect: UIEffect, key?: string): void
  removeEffect(effect: UIEffect): void
  application?: unknown
  setFace(face: unknown): void
  setHandAnimation(name: string): void
  setFaceMotionEnabled?(enabled: boolean): void
  setConnectionIndicator?(visible: boolean): void
  setMain(content: unknown, options?: MainScreenOptions | (() => void)): () => void
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
