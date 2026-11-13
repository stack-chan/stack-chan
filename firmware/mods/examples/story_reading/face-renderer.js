/** Receives host face snapshots; changes only the drawn gaze, never the motion capability. */
export class ReadingFaceRenderer {
  #context
  #copy
  #captured
  #drawn
  #requested

  constructor(context, createState, copyState) {
    this.#context = context
    this.#copy = copyState
    this.#captured = createState()
    this.#drawn = createState()
  }

  capture(state) {
    this.#copy(state, this.#captured)
  }

  render(mouth, gaze) {
    this.#requested = { mouth, gaze }
    // Playback disables the host's periodic face updates. This immediate update also
    // supplies current palette/eye/emotion values through the observer effect.
    this.#context.face.setMouthOpen(mouth, true)
    this.#copy(this.#captured, this.#drawn)
    this.#drawn.mouth.open = mouth
    for (const side of ['left', 'right']) {
      this.#drawn.eyes[side].gazeX = gaze.x
      this.#drawn.eyes[side].gazeY = gaze.y
    }
    this.#context.ui.update(0, this.#drawn)
  }

  restore() {
    if (this.#requested) this.render(this.#requested.mouth, this.#requested.gaze)
  }

  clear() {
    this.#requested = undefined
    this.#context.face.setMouthOpen(0, true)
  }
}
