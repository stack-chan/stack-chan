import { registerPlayers } from 'media-apps'
import { installLookAround } from 'media-look-around'
import { installVolume } from 'media-volume'
import { randomBetween } from 'stackchan-util'
import Timer from 'timer'
import { STATIONS } from 'web-radio-config'

let closeLookAround
export async function onContextCreated(context) {
  if (typeof context.audio.volume !== 'number') {
    context.showBalloon(context.i18n.localize('podcast.hostRequired'))
    return
  }
  try {
    await closeLookAround?.()
  } catch (error) {
    trace(`[media] look-around cleanup failed: ${String(error)}\n`)
  }
  registerPlayers(
    context,
    STATIONS.map(({ label, url }) => ({ title: label, url })),
  )
  installVolume(context)
  closeLookAround = installLookAround(context, Timer, randomBetween)
}
