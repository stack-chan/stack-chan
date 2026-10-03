/** Podcast selection and lifetime. Dependencies keep network and UI tests deterministic. */
export class PodcastController {
  #context
  #feeds
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
      feedIndex: this.#feedIndex,
      episodeIndex: this.#episodeIndex,
      status: this.#context.i18n?.localize(this.#status) ?? this.#status,
      state: this.#state,
      loading: this.#loading,
      feedError: this.#feedError,
      playbackError: this.#playbackError,
      artEnabled: !!this.#loadArtwork,
      progress: this.#progress,
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

  constructor(context, feeds, loadFeed, effects, loadArtwork) {
    this.#context = context
    this.#feeds = feeds
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
    this.#playGeneration += 1
    this.#request?.cancel()
    this.#request = undefined
    this.#context.audio.media?.stop()
    this.#restore()
    this.#loading = false
    this.#state = 'idle'
    this.#playbackError = undefined
    this.#progress = { position: 0, duration: undefined, estimated: false, seekable: false }
    this.#notice('podcast.idle')
  }

  close() {
    this.#closed = true
    this.#clearArtwork()
    this.stop()
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
    this.#indicator(true)
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
        this.#indicator(false)
        this.#render()
      }
    }
  }

  pause() {
    this.#context.audio.media?.pause()
  }

  async seek(seconds) {
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
    if (this.#state === 'paused') {
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
    if (this.#closed) return
    const episode = this.#episodes[this.#episodeIndex]
    if (!episode) {
      this.#notice('podcast.chooseEpisode')
      return
    }
    this.stop()
    const generation = this.#playGeneration
    const context = this.#context
    context.ui.setFaceMotionEnabled?.(false)
    this.#notice(episode.title)
    try {
      await context.audio.media.start({
        url: episode.url,
        mode: 'finite',
        volume: 0.2,
        duration: episode.duration,
        onProgress: (progress) => {
          if (generation !== this.#playGeneration || this.#closed) return
          this.#progress = progress
          this.#render()
        },
        onStateChanged: (state, reason) => {
          if (generation !== this.#playGeneration || this.#closed) return
          this.#state = state
          const labels = {
            connecting: 'podcast.connecting',
            buffering: 'podcast.buffering',
            playing: 'podcast.playing',
            stalled: 'podcast.stalled',
            idle: 'podcast.idle',
            paused: 'podcast.paused',
            ended: 'podcast.ended',
            error: 'podcast.playFailed',
          }
          this.#notice(labels[state] ?? state)
          this.#indicator(state === 'connecting' || state === 'buffering' || state === 'stalled')
          if (state === 'playing') {
            context.ui.setFaceMotionEnabled?.(false)
            this.#effects.show()
            return
          }
          this.#effects.hide()
          if (state === 'ended' || state === 'idle' || state === 'error' || state === 'paused') this.#restore()
          if (state === 'ended') this.#notice('podcast.ended')
          if (state === 'error') this.#notice(`Podcast error: ${reason ?? 'unknown'}`)
        },
      })
    } catch (error) {
      if (generation !== this.#playGeneration) return
      this.#state = 'error'
      this.#restore()
      this.#notice(`Podcast error: ${String(error)}`)
    }
  }
}
