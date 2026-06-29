export type TouchPanelSample = number[]

export type TouchPanelGestureType = 'press' | 'release' | 'forwardSwipe' | 'backwardSwipe'

export type TouchPanelGesture = {
  type: TouchPanelGestureType
  sample: TouchPanelSample
  ticks: number
}

export type TouchPanelGestureRecognizerOptions = {
  touchThreshold?: number
  swipeThreshold?: number
}

type TouchState = 'idle' | 'touched' | 'swiping'

export class GestureRecognizer {
  #state: TouchState = 'idle'
  #initialPosition = 0
  #touchThreshold: number
  #swipeThreshold: number

  constructor(options: TouchPanelGestureRecognizerOptions = {}) {
    this.#touchThreshold = options.touchThreshold ?? 1
    this.#swipeThreshold = options.swipeThreshold ?? 40
  }

  reset(): void {
    this.#state = 'idle'
    this.#initialPosition = 0
  }

  update(sample: TouchPanelSample, ticks: number): TouchPanelGesture | undefined {
    switch (this.#state) {
      case 'idle':
        if (this.#isTouched(sample)) {
          this.#state = 'touched'
          this.#initialPosition = this.getPosition(sample)
          return { type: 'press', sample: [...sample], ticks }
        }
        break

      case 'touched':
        if (!this.#isTouched(sample)) {
          this.#state = 'idle'
          return { type: 'release', sample: [...sample], ticks }
        }

        {
          const delta = this.getPosition(sample) - this.#initialPosition
          if (delta > this.#swipeThreshold) {
            this.#state = 'swiping'
            return { type: 'forwardSwipe', sample: [...sample], ticks }
          }
          if (delta < -this.#swipeThreshold) {
            this.#state = 'swiping'
            return { type: 'backwardSwipe', sample: [...sample], ticks }
          }
        }
        break

      case 'swiping':
        if (!this.#isTouched(sample)) {
          this.#state = 'idle'
          return { type: 'release', sample: [...sample], ticks }
        }
        break
    }

    return undefined
  }

  getPosition(sample: TouchPanelSample): number {
    const left = sample[0] ?? 0
    const center = sample[1] ?? 0
    const right = sample[2] ?? 0
    const total = left + center + right
    if (total === 0) return 0

    return Math.trunc((left * -100 + center * 0 + right * 100) / total)
  }

  #isTouched(sample: TouchPanelSample): boolean {
    // Si12T reports three intensity levels; any zone over the threshold is a touch.
    return Math.max(sample[0] ?? 0, sample[1] ?? 0, sample[2] ?? 0) >= this.#touchThreshold
  }
}
