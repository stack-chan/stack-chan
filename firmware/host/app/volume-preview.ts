export type VolumePreviewPlayer = (volume: number) => Promise<void>

export type VolumePreviewQueueOptions = Readonly<{
  play: VolumePreviewPlayer
  onError?: (error: unknown) => void
}>

export class VolumePreviewQueue {
  readonly #play: VolumePreviewPlayer
  readonly #onError?: (error: unknown) => void
  #active: Promise<void> | undefined
  #pending: number | undefined
  #closed = false

  constructor(options: VolumePreviewQueueOptions) {
    this.#play = options.play
    this.#onError = options.onError
  }

  request(volume: number): void {
    if (this.#closed) return
    this.#pending = volume
    this.#playNext()
  }

  close(): Promise<void> {
    this.#closed = true
    this.#pending = undefined
    return this.#active ?? Promise.resolve()
  }

  #playNext(): void {
    if (this.#closed || this.#active || this.#pending === undefined) return
    const volume = this.#pending
    this.#pending = undefined
    const active = Promise.resolve()
      .then(() => this.#play(volume))
      .catch((error) => {
        try {
          this.#onError?.(error)
        } catch {
          // Reporting must not leave the preview queue permanently active.
        }
      })
      .then(() => {
        if (this.#active !== active) return
        this.#active = undefined
        this.#playNext()
      })
    this.#active = active
  }
}
