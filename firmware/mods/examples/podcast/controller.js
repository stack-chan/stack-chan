/** Podcast selection and lifetime. Dependencies keep network and UI tests deterministic. */
export class PodcastController {
  #context
  #feeds
  #loadFeed
  #effects
  #request
  #generation = 0
  #playGeneration = 0
  #feedIndex = 0
  #episodeIndex = 0
  #episodes = []
  #closed = false
  #listeners = new Set()
  #status = '停止中'
  #state = 'idle'
  #loading = false
  #progress = { position: 0, duration: undefined, estimated: false, seekable: false }

  get snapshot() {
    return {
      feeds: this.#feeds,
      episodes: this.#episodes,
      feedIndex: this.#feedIndex,
      episodeIndex: this.#episodeIndex,
      status: this.#status,
      state: this.#state,
      loading: this.#loading,
      progress: this.#progress,
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
    this.#notice('再生を押してください')
  }

  constructor(context, feeds, loadFeed, effects) {
    this.#context = context
    this.#feeds = feeds
    this.#loadFeed = loadFeed
    this.#effects = effects
  }

  async start() {
    const context = this.#context
    if (!context.audio.media) {
      this.#notice('Podcastには対応ホストへの更新が必要です。')
      return
    }
    if (!this.#feeds.length) {
      this.#notice('config.tsのfeedsに番組名とRSS URLを登録してください。')
      return
    }
    this.#render()
    const generation = this.#generation
    const ready = await context.connectivity.network?.ready
    if (this.#closed || generation !== this.#generation) return
    if (ready?.status !== 'connected') {
      this.#notice('Wi-Fiに接続してください。')
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
    this.#progress = { position: 0, duration: undefined, estimated: false, seekable: false }
    this.#notice('停止中')
  }

  close() {
    this.#closed = true
    this.stop()
    this.#listeners.clear()
  }

  async refresh() {
    if (this.#closed || !this.#feeds.length || !this.#context.audio.media) return
    const identity = this.#episodes[this.#episodeIndex]?.identity
    this.stop()
    const generation = this.#generation
    this.#indicator(true)
    this.#loading = true
    this.#notice('エピソードを取得中…')
    try {
      const request = this.#loadFeed(this.#feeds[this.#feedIndex].url)
      this.#request = request
      const result = await request.promise
      if (this.#closed || generation !== this.#generation) return
      this.#request = undefined
      this.#episodes = result.episodes
      this.#episodeIndex = Math.max(
        0,
        this.#episodes.findIndex((episode) => episode.identity === identity),
      )
      this.#render()
      this.#notice(
        !this.#episodes.length
          ? '再生できるMP3エピソードがありません。'
          : `${result.title || this.#feeds[this.#feedIndex].title}${result.limited ? '\n一覧は取得上限まで表示しています。' : ''}`,
      )
    } catch (error) {
      if (generation !== this.#generation || this.#closed) return
      this.#request = undefined
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
    try {
      await this.#context.audio.media.seek(seconds)
    } catch (error) {
      if (generation === this.#playGeneration) this.#notice(`Seek error: ${String(error)}`)
    }
  }

  async play() {
    if (this.#state === 'paused') {
      const generation = this.#playGeneration
      try {
        await this.#context.audio.media.resume()
      } catch (error) {
        if (generation === this.#playGeneration) this.#notice(`Podcast error: ${String(error)}`)
      }
      return
    }
    if (this.#closed) return
    const episode = this.#episodes[this.#episodeIndex]
    if (!episode) {
      this.#notice('エピソードを選択してください。')
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
            connecting: '接続中…',
            buffering: '読み込み中…',
            playing: '再生中',
            stalled: '待機中…',
            idle: '停止中',
            paused: '一時停止',
            ended: '再生終了',
            error: '再生エラー',
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
          if (state === 'ended') this.#notice(`再生終了\n${episode.title}`)
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
