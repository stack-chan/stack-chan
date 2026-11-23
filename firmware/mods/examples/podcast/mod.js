import { registerPlayers } from 'media-apps'

export function onContextCreated(context) {
  if (typeof context.audio.media?.open !== 'function') {
    context.showBalloon(context.i18n.localize('podcast.hostRequired'))
    return
  }
  registerPlayers(context)
}
