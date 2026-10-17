import { registerPlayers } from 'media-apps'
import { installVolume } from 'media-volume'
import { STATIONS } from 'web-radio-config'

export function onContextCreated(context) {
  if (typeof context.audio.volume !== 'number') throw new Error(context.i18n.localize('podcast.hostRequired'))
  registerPlayers(
    context,
    STATIONS.map(({ label, url }) => ({ title: label, url })),
  )
  installVolume(context)
}
