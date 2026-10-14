import { Behavior, Container, Label, Port, Skin, Style, Text } from 'piu/MC'
import RuntimeBitmapPort from 'runtime-bitmap-port'

const background = new Skin({ fill: '#f8fafc' })
const surface = new Skin({ fill: ['#e2e8f0', '#cbd5e1'] })
const primary = new Skin({ fill: ['#2563eb', '#1d4ed8'] })
const disabled = new Skin({ fill: '#edf0f4' })
const playbackLabels = {
  connecting: 'podcast.connecting',
  buffering: 'podcast.buffering',
  stalled: 'podcast.stalled',
  retrying: 'podcast.retrying',
  paused: 'podcast.paused',
  ended: 'podcast.ended',
  error: 'podcast.playFailed',
}

class Tap extends Behavior {
  onCreate(_content, data) {
    this.action = data.action
  }
  onTouchBegan(content, _id, x, y) {
    this.x = x
    this.y = y
    this.cancelled = false
    content.state = 1
  }
  onTouchMoved(content, _id, x, y) {
    if (Math.abs(x - this.x) + Math.abs(y - this.y) > 12) {
      this.cancelled = true
      content.state = 0
    }
  }
  onTouchCancelled(content) {
    this.cancelled = true
    content.state = 0
  }
  onTouchEnded(content, _id, x, y) {
    content.state = 0
    if (!this.cancelled && content.hit(x, y)) this.action()
  }
}

function button(styles, name, text, action, bounds, enabled = true, accent = false) {
  return new Container(
    { action },
    {
      name,
      ...bounds,
      active: enabled,
      clip: true,
      skin: !enabled ? disabled : accent ? primary : surface,
      Behavior: Tap,
      contents: [
        new Text(null, {
          left: 8,
          right: 8,
          top: 4,
          bottom: 4,
          string: text,
          style: accent && enabled ? styles.white : styles.body,
        }),
      ],
    },
  )
}

class Icon extends Behavior {
  onCreate(_port, data) {
    this.icon = data.icon
    this.enabled = data.enabled
  }
  onDraw(port) {
    const color = this.enabled ? '#ffffff' : '#94a3b8'
    const x = Math.floor(port.width / 2),
      y = Math.floor(port.height / 2)
    if (this.icon === 'play') {
      for (let row = -9; row <= 9; row++) port.fillColor(color, x - 6, y + row, 14 - Math.abs(row), 1)
    } else if (this.icon === 'pause') {
      port.fillColor(color, x - 8, y - 9, 5, 18)
      port.fillColor(color, x + 3, y - 9, 5, 18)
    } else port.fillColor(color, x - 8, y - 8, 16, 16)
  }
}

function iconButton(styles, name, icon, action, bounds, enabled) {
  const result = button(styles, name, '', action, bounds, enabled, true)
  result.empty()
  result.add(new Port({ icon, enabled }, { left: 0, right: 0, top: 0, bottom: 0, Behavior: Icon }))
  return result
}

function time(seconds) {
  seconds = Math.max(0, Math.floor(seconds || 0))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

class Seek extends Behavior {
  onCreate(_port, data) {
    this.commit = data.commit
    this.preview = data.preview
    this.dragging = false
  }
  update(port, progress) {
    this.progress = progress
    port.active = progress.seekable
    port.invalidate()
    if (!this.dragging) this.preview(progress.position)
  }
  onDraw(port) {
    const duration = this.progress.duration || 1
    const position = this.dragging ? this.target : this.progress.position
    const length = port.width - 16
    const end = Math.max(0, Math.min(length, Math.round((position / duration) * length)))
    port.fillColor('#cbd5e1', 8, 13, length, 4)
    port.fillColor('#2563eb', 8, 13, end, 4)
    port.fillColor(port.active ? '#2563eb' : '#94a3b8', 4 + end, 8, 8, 14)
  }
  onTouchBegan(port, id, x, y, ticks) {
    this.dragging = true
    port.captureTouch(id, x, y, ticks)
    this.onTouchMoved(port, id, x, y)
  }
  onTouchMoved(port, _id, x) {
    this.target = Math.max(0, Math.min(1, (x - port.x - 8) / (port.width - 16))) * this.progress.duration
    this.preview(this.target)
    port.invalidate()
  }
  onTouchEnded(port, id, x, y) {
    this.onTouchMoved(port, id, x, y)
    this.dragging = false
    void this.commit(this.target)
  }
  onTouchCancelled(port) {
    this.dragging = false
    this.update(port, this.progress)
  }
}

class Artwork extends Behavior {
  onCreate(_port, data) {
    this.bitmap = data.artwork
  }
  onDraw(port) {
    port.fillColor('#e2e8f0', 0, 0, 64, 64)
    if (this.bitmap) port.drawBitmap(this.bitmap, 0, 0)
    else {
      port.fillColor('#94a3b8', 29, 16, 5, 30)
      port.fillColor('#94a3b8', 29, 16, 17, 5)
      port.fillColor('#94a3b8', 19, 39, 15, 9)
    }
  }
}

/** Regular MOD mini app: audio stays under the host's shared media owner. */
export function createPodcastView(controller, context, i18n) {
  const t = i18n.localize
  const font = i18n.locale === 'zh-CN' ? 'PodcastCJK-12' : 'k8x12-12'
  const style = new Style({ font, color: '#0f172a', horizontal: 'left', vertical: 'middle' })
  const styles = {
    body: style,
    white: new Style({ font, color: '#ffffff', horizontal: 'center', vertical: 'middle' }),
  }
  const root = new Container(null, {
    name: 'podcast',
    width: context.width,
    height: context.height,
    skin: background,
    clip: true,
  })
  let screen = 'player',
    page = 0,
    closed = false
  let snapshot = controller.snapshot
  let seek, clock, artworkPort
  let renderKey
  const bottom = context.height - 40
  const width = context.width
  const rows = Math.max(1, Math.floor((bottom - 40) / 38))
  const switchScreen = (next) => {
    screen = next
    page = 0
    render()
  }
  const add = (...args) => root.add(button(styles, ...args))
  function render() {
    if (closed) return
    seek = clock = artworkPort = undefined
    root.empty()
    const state = snapshot
    if (screen !== 'player') {
      const items = screen === 'feeds' ? state.feeds : state.episodes
      page = Math.min(page, Math.max(0, Math.ceil(items.length / rows) - 1))
      root.add(
        new Label(null, {
          left: 8,
          right: 8,
          top: 0,
          height: 32,
          string: `${t(screen === 'feeds' ? 'podcast.feeds' : 'podcast.episodes')}  ${items.length ? page + 1 : 0}/${Math.ceil(items.length / rows)}`,
          style,
        }),
      )
      if (!items.length)
        root.add(
          new Text(null, {
            left: 8,
            right: 8,
            top: 40,
            bottom: 44,
            style,
            string: t(state.loading ? 'podcast.loading' : 'podcast.empty'),
          }),
        )
      items.slice(page * rows, (page + 1) * rows).forEach((item, offset) => {
        const index = page * rows + offset
        const selected = index === (screen === 'feeds' ? state.feedIndex : state.episodeIndex)
        add(
          `item:${index}`,
          `${selected ? '● ' : ''}${item.title}`,
          () => {
            const feed = screen === 'feeds'
            screen = 'player'
            if (feed) void controller.selectFeed(index)
            else controller.selectEpisode(index)
            render()
          },
          { left: 4, right: 4, top: 34 + offset * 38, height: 34 },
        )
      })
      add('back', t('podcast.back'), () => switchScreen('player'), { left: 4, top: bottom, width: 92, height: 36 })
      add(
        'previous',
        t('podcast.previous'),
        () => {
          page--
          render()
        },
        { left: 104, top: bottom, width: 96, height: 36 },
        page > 0,
      )
      add(
        'next',
        t('podcast.next'),
        () => {
          page++
          render()
        },
        { left: 208, right: 4, top: bottom, height: 36 },
        (page + 1) * rows < items.length,
      )
      return
    }
    const contentLeft = state.artEnabled ? 80 : 8
    const canRetry = state.feedError === 'podcast.feedFailed' && !state.loading && !!state.feeds.length
    if (state.artEnabled) {
      artworkPort = new RuntimeBitmapPort(state, {
        name: 'artwork',
        left: 8,
        top: 8,
        width: 64,
        height: 64,
        Behavior: Artwork,
      })
      root.add(artworkPort)
    }
    add(
      'feed',
      t('podcast.feedField', { title: state.feeds[state.feedIndex]?.title ?? t('podcast.unregistered') }),
      () => switchScreen('feeds'),
      { left: contentLeft, right: 8, top: 4, height: 26 },
      state.feeds.length > 0,
    )
    add(
      'episode',
      t('podcast.episodeField', {
        title: state.loading
          ? t('podcast.loading')
          : state.feedError
            ? t(state.feedError)
            : `${state.episodes[state.episodeIndex]?.title ?? t('podcast.empty')}${state.episodes.length ? '  >' : ''}`,
      }),
      () => switchScreen('episodes'),
      { left: contentLeft, right: canRetry ? 68 : 8, top: 34, height: 64 },
      !state.loading && !!state.episodes.length,
    )

    clock = new Label(null, { name: 'time', left: 8, right: 8, top: bottom - 22, height: 18, style })
    seek = new Port(
      {
        commit: (seconds) => controller.seek(seconds),
        preview: (seconds) => {
          const labelKey = state.playbackError || playbackLabels[state.state]
          const label = labelKey && t(labelKey)
          const duration = state.progress.duration ? time(state.progress.duration) : '--:--'
          const position = `${time(seconds)} / ${state.progress.estimated ? t('podcast.approximate', { duration }) : duration}`
          clock.string = label ? `${label}  ${position}` : position
        },
      },
      { name: 'seek', left: 4, right: 4, top: bottom - 54, height: 32, Behavior: Seek },
    )
    root.add(seek)
    root.add(clock)
    seek.behavior.update(seek, state.progress)
    const active = ['connecting', 'buffering', 'playing', 'stalled', 'retrying'].includes(state.state)
    const half = Math.floor(width / 2)
    root.add(
      iconButton(
        styles,
        'play',
        active ? 'pause' : 'play',
        () => {
          if (active) controller.pause()
          else void controller.play()
        },
        { left: 8, width: half - 12, top: bottom, height: 36 },
        !!state.episodes.length && !state.loading,
      ),
    )
    root.add(
      iconButton(
        styles,
        'stop',
        'stop',
        () => controller.stop(),
        { left: half + 4, right: 8, top: bottom, height: 36 },
        state.state !== 'idle',
      ),
    )
    if (canRetry)
      add('refresh', t('podcast.refresh'), () => void controller.refresh(), {
        right: 8,
        width: 52,
        top: 34,
        height: 64,
      })
  }
  const unsubscribe = controller.subscribe((state) => {
    const key = [
      state.feeds,
      state.episodes,
      state.feedIndex,
      state.episodeIndex,
      state.state,
      state.feedError,
      state.playbackError,
      state.artEnabled,
      state.loading,
      state.progress.duration,
      state.progress.estimated,
      state.progress.seekable,
    ]
    const changed = !renderKey || key.some((value, index) => value !== renderKey[index])
    renderKey = key
    snapshot = state
    if (changed) render()
    else {
      if (seek) seek.behavior.update(seek, state.progress)
      if (artworkPort && artworkPort.behavior.bitmap !== state.artwork) {
        artworkPort.clearBitmap()
        artworkPort.behavior.bitmap = state.artwork
        artworkPort.invalidate()
      }
    }
  })
  return {
    content: root,
    dispose() {
      if (closed) return
      closed = true
      unsubscribe()
    },
  }
}
