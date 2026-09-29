import { MusicNotes } from 'effects/music-notes'
import { feeds } from 'podcast-config'
import { PodcastController } from 'podcast-controller'
import { loadFeed } from 'podcast-feed'
import { createPodcastView } from 'podcast-view'

let controller, unregister
export function onContextCreated(context) {
  unregister?.()
  controller?.close()
  const notes = new MusicNotes()
  controller = new PodcastController(context, feeds, loadFeed, {
    show: () => context.ui.addEffect(notes, 'podcast:music-notes'),
    hide: () => context.ui.removeEffect(notes),
  })
  const player = controller
  unregister = context.ui.miniApps.register({
    id: 'podcast',
    title: 'Podcast',
    icon: 'play',
    create: (miniContext) => createPodcastView(player, miniContext),
  })
  void player.start()
}
