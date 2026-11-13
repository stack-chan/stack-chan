import { registerPlayers } from 'media-apps'
import { installVolume } from 'media-volume'
import { STATIONS } from 'web-radio-config'

export async function onContextCreated(context) {
  trace(
    '[momotaro] capabilities ' +
      JSON.stringify({
        audio: !!context.audio,
        motion: !!context.motion,
        ui: !!context.ui,
        media: !!context.audio?.media,
        volume: typeof context.audio?.volume,
      }) +
      '\n',
  )
  try {
    if (typeof context.audio.volume !== 'number') {
      context.showBalloon(context.i18n.localize('podcast.hostRequired'))
      return
    }
    // Native host interlock already keeps servo power off; do not request motor activation.
    const player = registerPlayers(
      context,
      STATIONS.map(({ label, url }) => ({ title: label, url })),
    )
    installVolume(context)
    let lastState,
      lastBucket = -1
    player.subscribe((s) => {
      const bucket = Math.floor(s.progress.position / 15)
      if (lastState !== s.state || lastBucket !== bucket) {
        lastState = s.state
        lastBucket = bucket
        trace(
          '[momotaro] ' +
            JSON.stringify({
              state: s.state,
              position: Math.round(s.progress.position),
              duration: s.progress.duration,
              episodes: s.episodes.length,
              loading: s.loading,
              feedError: s.feedError,
              playbackError: s.playbackError,
            }) +
            '\n',
        )
      }
    })
    await player.start()
    trace(
      '[momotaro] public source ready ' +
        JSON.stringify({
          episodes: player.snapshot.episodes.length,
          feedError: player.snapshot.feedError,
          state: player.snapshot.state,
          autoplay: false,
        }) +
        '\n',
    )
  } catch (e) {
    trace(`[momotaro] startup error ${String(e)}\n`)
    throw e
  }
}
