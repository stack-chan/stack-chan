declare const audioBridge: {
  tone(hz: number, duration: number, volume?: number): void
  close(): void
  startPlayBuffer(buffer: ArrayBuffer): void
  playStatus(): number
  startRecord(duration: number): void
  recordStatus(): number
  recordBuffer(): ArrayBuffer
  setTimer(callback: () => void, delay?: number): unknown
}

export default audioBridge
