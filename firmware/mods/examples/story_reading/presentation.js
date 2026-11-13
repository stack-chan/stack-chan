import { READING_TICK_MS, ReadingChoreography } from 'reading-choreography'
export const PRESENTATION_MODES = ['reading', 'music', 'none']
const BOOK_STATES = ['connecting', 'buffering', 'playing', 'paused', 'stalled', 'retrying']

/** Owns visuals only. Playback, saved settings, and physical motion stay with their existing owners. */
export class ReadingPresentation {
  #ui
  #face
  #timer
  #book
  #notes
  #mode = 'reading'
  #state = 'idle'
  #active
  #tick
  #mouthOwned = false
  #variant = 0
  #onPhaseChange
  #generation = 0
  #closed = false

  constructor({ ui, face, timer, book, notes, onPhaseChange }) {
    this.#ui = ui
    this.#face = face
    this.#timer = timer
    this.#book = book
    this.#notes = notes
    this.#onPhaseChange = onPhaseChange
  }

  get mode() {
    return this.#mode
  }

  update(snapshot) {
    if (this.#closed) return
    this.#state = snapshot.playbackState ?? snapshot.state
    this.#render()
  }

  setMode(mode) {
    if (this.#closed || !PRESENTATION_MODES.includes(mode)) return false
    this.#mode = mode
    this.#render()
    return true
  }

  #render() {
    const reading = this.#mode === 'reading'
    const effect = reading
      ? BOOK_STATES.includes(this.#state)
        ? this.#book
        : undefined
      : this.#mode === 'music' && this.#state === 'playing'
        ? this.#notes
        : undefined
    if (effect !== this.#active) {
      if (this.#active) this.#ui.removeEffect(this.#active)
      this.#active = effect
      if (effect) this.#ui.addEffect(effect, 'media:presentation')
    }
    if (reading && this.#state === 'playing') {
      if (this.#tick !== undefined) return
      const animation = new ReadingChoreography()
      let wasTurning = false
      const generation = ++this.#generation
      this.#mouthOwned = true
      this.#tick = this.#timer.repeat(() => {
        if (this.#closed || generation !== this.#generation) return
        const frame = animation.advance()
        if (frame.turning) {
          if (!wasTurning) this.#face.render(0, frame.gaze)
          this.#setVariant(frame.variant)
        } else {
          this.#setVariant(0)
          this.#face.render(frame.mouth, frame.gaze)
        }
        if (frame.turning !== wasTurning) this.#onPhaseChange?.(frame.turning ? 'page-turn' : 'reading')
        wasTurning = frame.turning
      }, READING_TICK_MS)
      return
    }
    this.#stopMouth()
  }

  #stopMouth() {
    ++this.#generation
    if (this.#tick !== undefined) this.#timer.clear(this.#tick)
    this.#tick = undefined
    if (this.#mouthOwned) this.#face.clear()
    this.#setVariant(0)
    this.#mouthOwned = false
  }

  #setVariant(variant) {
    if (variant === this.#variant) return
    this.#variant = variant
    // The face can be detached while a mini-app is open; Piu delegate requires attachment.
    this.#book.behavior.onPageVariant(this.#book, variant)
  }

  close() {
    if (this.#closed) return
    this.#closed = true
    this.#stopMouth()
    if (this.#active) this.#ui.removeEffect(this.#active)
    this.#active = undefined
  }
}

export function installPresentationChoice(context, presentation) {
  const key = 'media:presentation-mode'
  const labels = { reading: 'Reading', music: 'Music', none: 'Off' }
  const sync = () =>
    context.drawer.addDrawerButton({
      key,
      label: 'Visuals',
      kind: 'choice',
      value: presentation.mode,
      options: PRESENTATION_MODES.map((value) => ({ value, label: labels[value] })),
      callback(_context, value) {
        if (presentation.setMode(value)) sync()
      },
    })
  sync()
  return () => context.drawer.removeDrawerButton(key)
}
