export const speakers: SettingsSpeaker[] = []

export default class SettingsSpeaker {
  tones: Array<{ frequency: number; duration: number; volume?: number }> = []
  #finishTone: (() => void) | undefined

  constructor(_options?: unknown) {
    speakers.push(this)
  }

  tone(frequency: number, duration: number, volume?: number): Promise<void> {
    this.tones.push({ frequency, duration, volume })
    return new Promise((resolve) => {
      this.#finishTone = resolve
    })
  }

  finishTone(): void {
    this.#finishTone?.()
    this.#finishTone = undefined
  }
}
