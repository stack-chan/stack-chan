import type { WebRadioCapability, WebRadioStartOptions, WebRadioState } from 'capabilities'
import type { Speaker } from 'stackchan/voice/contracts'
import MediaPlayer from 'media-player'

/** Backwards-compatible live-only entry point. The runtime shares its media owner. */
export default class WebRadioPlayer implements WebRadioCapability {
  #media: MediaPlayer
  constructor(getSpeaker: () => Speaker) {
    this.#media = new MediaPlayer(getSpeaker)
  }
  get state(): WebRadioState {
    return this.#media.state === 'ended' || this.#media.state === 'paused' ? 'idle' : this.#media.state
  }
  async start(options: WebRadioStartOptions): Promise<void> {
    if ((options.sampleRate ?? 44100) !== 44100) throw new Error('WebRadio supports only 44100 Hz sampleRate options')
    await this.#media.start({
      ...options,
      mode: 'live',
      onStateChanged: (state, reason) =>
        options.onStateChanged?.(state === 'ended' || state === 'paused' ? 'idle' : state, reason),
    })
  }
  stop() {
    return this.#media.stop()
  }
  close() {
    return this.#media.close()
  }
  setVolume(volume: number): void {
    this.#media.setVolume(volume)
  }
}
