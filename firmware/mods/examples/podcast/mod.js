import { MusicNotes } from 'effects/music-notes'
import { loadArtwork } from 'podcast-artwork'
import { feeds } from 'podcast-config'
import { PodcastController } from 'podcast-controller'
import { loadFeed } from 'podcast-feed'
import { createPodcastView } from 'podcast-view'

let controller, unregister
export function onContextCreated(context) {
  unregister?.()
  controller?.close()
  const notes = new MusicNotes()
  controller = new PodcastController(
    context,
    feeds,
    loadFeed,
    {
      show: () => context.ui.addEffect(notes, 'podcast:music-notes'),
      hide: () => context.ui.removeEffect(notes),
    },
    loadArtwork,
  )
  const player = controller
  let started = false
  unregister = context.ui.miniApps.register({
    id: 'podcast',
    title: context.i18n.localize('podcast.title'),
    icon: 'play',
    create: (miniContext) => {
      const view = createPodcastView(player, miniContext, context.i18n)
      // Defer network/TLS and RSS work until the user opens the Podcast app.
      // Subsequent openings reuse the controller, including ongoing playback.
      if (!started) {
        started = true
        void player.start()
      }
      return view
    },
  })
}
