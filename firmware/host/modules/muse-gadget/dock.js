import { createMuseSession } from 'muse-client'
import { createMuseDockRuntime } from 'muse-dock-runtime'
import Preference from 'preference'

let active

export function getMuseSession() {
  return active
}

export default {
  start(modConfig) {
    if (modConfig?.muse?.enabled !== true) return
    active?.close()
    active = createMuseDockRuntime(
      createMuseSession,
      (key) => Preference.get('muse', key),
      () => {
        active = undefined
      },
    )
    return active
  },
}
