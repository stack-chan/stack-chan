import type { TTSCompletion, TTSDoneListener, TTSPlaybackListener } from 'tts-types'

export type TTS = {
  stream: (text: string, volume?: number, callback?: TTSCompletion) => void
  onPlayed?: TTSPlaybackListener
  onDone?: TTSDoneListener
}

export type RobotLed = {
  on(r: number, g: number, b: number, duration?: number, index?: number, count?: number): void
  off(index?: number, count?: number): void
  blink(r: number, g: number, b: number, duration: number, index?: number, count?: number): void
  rainbow(index?: number, count?: number): void
}

export type RobotUI = Partial<{
  update(interval: number, faceState: unknown): void
  addEffect(effect: unknown, key?: string): void
  removeEffect(effect: unknown): void
  application: unknown
  setFace(face: unknown): void
  setMain(content: unknown): void
  showFace(): void
  setDrawerButtons(buttons: unknown[]): void
  addDrawerButton(button: unknown): void
  removeDrawerButton(key: string): void
  setDrawerButtonState(key: string, active: boolean): void
  bindDrawerAction(key: string, callback: () => void): boolean
  unbindDrawerAction(key: string): void
  openDrawer(): void
  closeDrawer(): void
  toggleDrawer(): void
}>
