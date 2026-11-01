/** Podcast selection and shared finite/live playback. Network and UI dependencies are supplied by the MOD. */
export class PodcastController {
  #context
  #feeds
  #stations
  #stationIndex = 0
  #source
  #reason
  #loadFeed
  #effects
  #loadArtwork
  #artRequest
  #artGeneration = 0
  #feedArtwork
  #artURL
  #artwork
  #artState = 'empty'
  #request
  #generation = 0
  #playGeneration = 0
  #feedIndex = 0
  #episodeIndex = 0
  #episodes = []
  #closed = false
  #listeners = new Set()
  #status = 'podcast.idle'
  #state = 'idle'
  #loading = false
  #feedError
  #playbackError
  #progress = { position: 0, duration: undefined, estimated: false, seekable: false }

  get snapshot() {
    return {
      feeds: this.#feeds,
      episodes: this.#episodes,
      stations: this.#stations,
      stationIndex: this.#stationIndex,
      source: this.#source,
      playbackState: this.#state,
      radioState: this.#source === 'radio' ? this.#state : 'idle',
      reason: this.#reason,
      feedIndex: this.#feedIndex,
      episodeIndex: this.#episodeIndex,
      status: this.#context.i18n?.localize(this.#status) ?? this.#status,
      state: this.#source === 'radio' ? 'idle' : this.#state,
      loading: this.#loading,
      feedError: this.#feedError,
      playbackError: this.#playbackError,
      artEnabled: !!this.#loadArtwork,
      progress:
        this.#source === 'radio'
          ? { position: 0, duration: undefined, estimated: false, seekable: false }
          : this.#progress,
      artwork: this.#artwork,
      artState: this.#artState,
    }
  }

  subscribe(listener) {
    this.#listeners.add(listener)
    listener(this.snapshot)
    return () => this.#listeners.delete(listener)
  }

  #render() {
    for (const listener of this.#listeners) listener(this.snapshot)
  }

  #notice(message) {
    this.#status = message
    this.#render()
  }

  selectFeed(index) {
    if (this.#closed || !Number.isInteger(index) || !this.#feeds[index]) return
    this.#feedIndex = index
    this.#episodes = []
    this.#episodeIndex = 0
    return this.refresh()
  }

  selectEpisode(index) {
    if (this.#closed || !Number.isInteger(index) || !this.#episodes[index]) return
    this.stop()
    this.#episodeIndex = index
    this.#notice('podcast.pressPlay')
    void this.#selectArtwork()
  }

  constructor(context, feeds, loadFeed, effects, loadArtwork, stations = []) {
    this.#context = context
    this.#feeds = feeds
    this.#stations = stations
    this.#loadFeed = loadFeed
    this.#effects = effects
    this.#loadArtwork = loadArtwork
  }

  #clearArtwork() {
    this.#artGeneration++
    this.#artRequest?.cancel()
    this.#artRequest = this.#artwork = this.#artURL = undefined
    this.#artState = 'empty'
  }

  async #selectArtwork() {
    const candidates = [...new Set([this.#episodes[this.#episodeIndex]?.artwork, this.#feedArtwork].filter(Boolean))]
    if (this.#artURL === candidates[0] && (this.#artState === 'loading' || this.#artState === 'ready')) return
    this.#clearArtwork()
    if (!this.#loadArtwork || !candidates.length || this.#closed) {
      this.#render()
      return
    }
    const generation = this.#artGeneration
    this.#artURL = candidates[0]
    this.#artState = 'loading'
    this.#render()
    for (const url of candidates) {
      try {
        this.#artRequest = this.#loadArtwork(url)
        const artwork = await this.#artRequest.promise
        if (this.#closed || generation !== this.#artGeneration) return
        this.#artwork = artwork
        this.#artState = 'ready'
        this.#artRequest = undefined
        this.#render()
        return
      } catch {
        if (this.#closed || generation !== this.#artGeneration) return
      }
    }
    this.#artRequest = undefined
    this.#artState = 'unavailable'
    this.#render()
  }

  async start() {
    const context = this.#context
    if (!context.audio.media) {
      this.#feedError = 'podcast.hostRequired'
      this.#render()
      return
    }
    if (!this.#feeds.length) {
      this.#feedError = 'podcast.noFeeds'
      this.#render()
      return
    }
    this.#render()
    const generation = this.#generation
    const ready = await context.connectivity.network?.ready
    if (this.#closed || generation !== this.#generation) return
    if (ready?.status !== 'connected') {
      this.#feedError = 'podcast.networkRequired'
      this.#render()
      return
    }
    await this.refresh()
  }

  #indicator(visible) {
    this.#context.ui.application?.distribute?.('onConnectionIndicator', visible)
  }
  #restore() {
    this.#indicator(false)
    this.#effects.hide()
    this.#context.ui.setFaceMotionEnabled?.(true)
  }

  stop() {
    this.#generation += 1
    this.#request?.cancel()
    this.#request = undefined
    this.#loading = false
    if (this.#source === 'radio') {
      this.#render()
      return
    }
    this.#stopPlayback()
  }

  #stopPlayback() {
    this.#playGeneration += 1
    this.#context.audio.media?.stop()
    this.#source = undefined
    this.#reason = undefined
    this.#restore()
    this.#state = 'idle'
    this.#playbackError = undefined
    this.#progress = { position: 0, duration: undefined, estimated: false, seekable: false }
    this.#notice('podcast.idle')
  }

  close() {
    if (this.#closed) return
    this.#closed = true
    this.#clearArtwork()
    this.stop()
    if (this.#source === 'radio') this.#stopPlayback()
    this.#listeners.clear()
  }

  async refresh() {
    if (this.#closed || !this.#feeds.length || !this.#context.audio.media) return
    this.#clearArtwork()
    this.#feedArtwork = undefined
    this.#feedError = undefined
    const identity = this.#episodes[this.#episodeIndex]?.identity
    this.stop()
    const generation = this.#generation
    this.#loading = true
    this.#render()
    try {
      const request = this.#loadFeed(this.#feeds[this.#feedIndex].url)
      this.#request = request
      const result = await request.promise
      if (this.#closed || generation !== this.#generation) return
      this.#request = undefined
      this.#feedArtwork = result.artwork
      this.#episodes = result.episodes
      this.#episodeIndex = Math.max(
        0,
        this.#episodes.findIndex((episode) => episode.identity === identity),
      )
      void this.#selectArtwork()
      this.#render()
    } catch (error) {
      if (generation !== this.#generation || this.#closed) return
      this.#request = undefined
      this.#feedError = 'podcast.feedFailed'
      this.#notice(`RSS error: ${String(error)}`)
    } finally {
      if (generation === this.#generation) {
        this.#loading = false
        this.#render()
      }
    }
  }

  pause() {
    if (this.#closed || this.#source !== 'podcast') return
    this.#context.audio.media?.pause()
  }

  async seek(seconds) {
    if (this.#closed || this.#source !== 'podcast') return
    const generation = this.#playGeneration
    this.#playbackError = undefined
    try {
      await this.#context.audio.media.seek(seconds)
    } catch (error) {
      if (generation === this.#playGeneration) {
        this.#playbackError = 'podcast.seekFailed'
        this.#notice(`Seek error: ${String(error)}`)
      }
    }
  }

  async play() {
    if (this.#closed) return
    if (this.#source === 'podcast' && this.#state === 'paused') {
      const generation = this.#playGeneration
      this.#playbackError = undefined
      try {
        await this.#context.audio.media.resume()
      } catch (error) {
        if (generation === this.#playGeneration) {
          this.#playbackError = 'podcast.resumeFailed'
          this.#notice(`Podcast error: ${String(error)}`)
        }
      }
      return
    }
    const episode = this.#episodes[this.#episodeIndex]
    if (!episode) {
      this.#notice('podcast.chooseEpisode')
      return
    }
    await this.#play('podcast', episode)
  }

  selectStation(index) {
    if (this.#closed || !Number.isInteger(index) || !this.#stations[index]) return
    this.stopRadio()
    this.#stationIndex = index
    this.#render()
  }

  stopRadio() {
    if (this.#closed || this.#source !== 'radio') return
    this.#stopPlayback()
  }

  async playRadio() {
    if (this.#closed) return
    const station = this.#stations[this.#stationIndex]
    if (station) await this.#play('radio', station)
  }

  async #play(source, item) {
    this.#playGeneration += 1
    const generation = this.#playGeneration
    const context = this.#context
    this.#source = source
    this.#progress = { position: 0, duration: undefined, estimated: false, seekable: false }
    this.#playbackError = undefined
    this.#reason = undefined
    this.#state = 'connecting'
    this.#effects.hide()
    this.#indicator(true)
    context.ui.setFaceMotionEnabled?.(false)
    this.#notice(item.title)
    if (generation !== this.#playGeneration || this.#closed) return
    try {
      await context.audio.media.start({
        url: item.url,
        mode: source === 'radio' ? 'live' : 'finite',
        duration: source === 'podcast' ? item.duration : undefined,
        onProgress: (progress) => {
          if (generation !== this.#playGeneration || this.#closed) return
          this.#progress = progress
          this.#render()
        },
        onStateChanged: (state, reason) => {
          if (generation !== this.#playGeneration || this.#closed) return
          this.#state = state
          this.#reason = reason
          const labels = {
            connecting: 'podcast.connecting',
            buffering: 'podcast.buffering',
            playing: 'podcast.playing',
            stalled: 'podcast.stalled',
            retrying: 'podcast.retrying',
            idle: 'podcast.idle',
            paused: 'podcast.paused',
            ended: 'podcast.ended',
            error: 'podcast.playFailed',
          }
          this.#notice(labels[state] ?? state)
          this.#indicator(['connecting', 'buffering', 'stalled', 'retrying'].includes(state))
          if (state === 'playing') {
            context.ui.setFaceMotionEnabled?.(false)
            this.#effects.show()
            return
          }
          this.#effects.hide()
          if (state === 'ended' || state === 'idle' || state === 'error' || state === 'paused') this.#restore()
          if (state === 'ended') this.#notice('podcast.ended')
          if (state === 'error') this.#notice(`Playback error: ${reason ?? 'unknown'}`)
        },
      })
    } catch (error) {
      if (generation !== this.#playGeneration) return
      // Validation may reject before the host replaces the previous stream.
      context.audio.media?.stop()
      this.#state = 'error'
      this.#reason = String(error)
      this.#restore()
      this.#notice(`Playback error: ${String(error)}`)
    }
  }
}
