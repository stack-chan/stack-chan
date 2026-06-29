import type Digital from 'embedded:io/digital'
import type { RobotCamera } from 'camera'
import type { Emotion, FaceState, FaceThemeKey } from 'face-state'
import type IMU from 'imu'
import type Led from 'led'
import type { Container as PiuContainer, Content as PiuContent } from 'piu/MC'
import type { Maybe, Pose, Rotation, Vector3 } from 'stackchan-util'
import type Touch from 'touch'
import type TouchPanel from 'touch-panel'

export type Driver = {
  applyRotation: (ori: Rotation, time?: number) => Promise<void>
  getRotation: () => Promise<Maybe<Rotation>>
  setTorque: (torque: boolean) => Promise<void>
  onAttached?: () => void
  onDetached?: () => void
}

export type TTS = {
  stream: (text: string, volume?: number) => Promise<void>
  onPlayed?: (volume: number) => void
  onDone?: () => void
}

export type UIEffect = PiuContent

export type RobotUI = {
  update: (interval: number, faceState: FaceState) => void
  addEffect(effect: UIEffect, key?: string): void
  removeEffect(effect: UIEffect): void
  application?: unknown
  setFace(face: PiuContainer): void
}

export type Button = {
  onChanged: (this: Digital) => void
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
  pose: {
    body: Pose
    eyes: {
      left: Pose
      right: Pose
    }
  }
  driver: Driver
  lookAt(position: Vector3): void
  lookAway(): void
  setPose(pose: Pose, time?: number): Promise<void>
  setTorque(torque: boolean): Promise<void>
}

export type AudioCapability = {
  tts: TTS
  microphone?: {
    record(durationMilliSec?: number): Promise<ArrayBuffer>
  }
  say(text: string, volume?: number): Promise<Maybe<string>>
  record(durationMilliSec?: number): Promise<ArrayBuffer>
  tone(hz: number, duration: number, volume?: number): Promise<void>
  playAudio(buffer: ArrayBuffer): Promise<boolean>
}

export type InputCapability = {
  button?: Partial<Record<'a' | 'b' | 'c' | 'power', Button>>
  touch?: Touch
  touchPanel?: TouchPanel
  imu?: IMU
}

export type LightingCapability = {
  led: Record<string, Led>
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

export type ConnectivityCapability = {
  network?: unknown
}

export type UICapability = {
  ui: RobotUI
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

export type StackchanContext = FaceCapability &
  MotionCapability &
  AudioCapability &
  InputCapability &
  LightingCapability &
  CameraCapability &
  ConversationCapability &
  ConnectivityCapability &
  UICapability
