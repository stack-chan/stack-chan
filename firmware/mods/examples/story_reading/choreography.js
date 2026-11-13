export const READING_TICK_MS = 120
export const PAGE_READING_MS = 20_000
export const PAGE_FRAME_MS = 200
export const PAGE_FRAME_COUNT = 5
const MOUTH_STEPS = [0.15, 0.5, 0.8, 0.3, 0, 0.55, 0.7, 0]

const lerp = (a, b, fraction) => a + (b - a) * fraction

/** Screen coordinates: right-to-left rows with a fast diagonal return to the next row. */
export function readingGaze(elapsed) {
  const time = elapsed % 8000
  if (time < 3400) return { x: lerp(0.9, -0.9, time / 3400), y: 0.2 }
  if (time < 4000) return { x: lerp(-0.9, 0.9, (time - 3400) / 600), y: lerp(0.2, 0.9, (time - 3400) / 600) }
  if (time < 7400) return { x: lerp(0.9, -0.9, (time - 4000) / 3400), y: 0.9 }
  return { x: lerp(-0.9, 0.9, (time - 7400) / 600), y: lerp(0.9, 0.2, (time - 7400) / 600) }
}

export class ReadingChoreography {
  #reading = 0
  #turning = false
  #turnTime = 0
  #gaze = readingGaze(0)
  #mouthStep = 0

  get frame() {
    return {
      mouth: this.#turning ? 0 : MOUTH_STEPS[this.#mouthStep],
      gaze: this.#gaze,
      variant: this.#turning ? 1 + Math.min(PAGE_FRAME_COUNT - 1, Math.floor(this.#turnTime / PAGE_FRAME_MS)) : 0,
      turning: this.#turning,
    }
  }

  advance(milliseconds = READING_TICK_MS) {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) throw new RangeError('Invalid animation interval')
    if (this.#turning) {
      this.#turnTime += milliseconds
      if (this.#turnTime >= PAGE_FRAME_MS * PAGE_FRAME_COUNT) {
        this.#turning = false
        this.#turnTime = this.#reading = this.#mouthStep = 0
        this.#gaze = readingGaze(0)
      }
    } else {
      this.#reading += milliseconds
      if (this.#reading >= PAGE_READING_MS) {
        this.#turning = true
        this.#turnTime = 0
      } else {
        this.#gaze = readingGaze(this.#reading)
        this.#mouthStep = (this.#mouthStep + 1) % MOUTH_STEPS.length
      }
    }
    return this.frame
  }
}
