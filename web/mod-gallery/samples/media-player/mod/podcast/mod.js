import { registerPlayers } from 'media-apps'

export function onContextCreated(context) {
  registerPlayers(context)
}
