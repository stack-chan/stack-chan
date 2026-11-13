import { MusicNotes } from 'effects/music-notes'
import { copyFaceState, createFaceState } from 'face-state'
import { loadArtwork } from 'podcast-artwork'
import { feeds } from 'podcast-config'
import { PodcastController } from 'podcast-controller'
import { loadFeed } from 'podcast-feed'
import { createPodcastView, createRadioView } from 'podcast-view'
import { ReadingBook } from 'reading-book'
import { FaceObserver } from 'reading-face-observer'
import { ReadingFaceRenderer } from 'reading-face-renderer'
import { installPresentationChoice, ReadingPresentation } from 'reading-presentation'
import Timer from 'timer'

let controller
let unregister = []
export function registerPlayers(context, stations = []) {
  for (const remove of unregister) remove()
  unregister = []
  controller?.close()
  const renderer = new ReadingFaceRenderer(context, createFaceState, copyFaceState)
  const observer = new FaceObserver(renderer)
  context.ui.addEffect(observer, 'media:reading-face-observer')
  unregister.push(() => context.ui.removeEffect(observer))
  const presentation = new ReadingPresentation({
    ui: context.ui,
    face: renderer,
    timer: Timer,
    book: new ReadingBook(),
    notes: new MusicNotes(),
    onPhaseChange: (phase) => trace(`[reading] phase=${phase}\n`),
  })
  controller = new PodcastController(
    context,
    feeds,
    loadFeed,
    {
      show() {},
      hide() {},
    },
    loadArtwork,
    stations,
  )
  unregister.push(controller.subscribe((snapshot) => presentation.update(snapshot)))
  unregister.push(() => presentation.close())
  unregister.push(installPresentationChoice(context, presentation))
  const player = controller
  let started = true
  unregister.push(
    context.ui.miniApps.register({
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
    }),
  )
  if (stations.length)
    unregister.push(
      context.ui.miniApps.register({
        id: 'web-radio',
        title: context.i18n.localize('radio.title'),
        icon: 'play',
        create: (miniContext) => createRadioView(player, miniContext, context.i18n),
      }),
    )
  trace('[momotaro] registered Podcast/Radio\n')
  return player
}
