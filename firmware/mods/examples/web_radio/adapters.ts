import type { StackchanContext } from 'capabilities'
import { MusicNotes } from 'effects/music-notes'
import { fromPromise } from 'stackchan-result'
import type { RadioError, Station } from 'web-radio-domain'
import type { RadioNetworkPort, RadioPlaybackPort, RadioUiPort, RadioWorkflowDeps } from 'web-radio-workflow'

const EFFECT_KEY = 'web-radio:music-notes'

export function createWebRadioDeps(context: StackchanContext, stations: readonly Station[]): RadioWorkflowDeps {
  const notes = new MusicNotes()
  const contextNetwork = context.connectivity.network
  const contextRadio = context.audio.webRadio

  const network: RadioNetworkPort | undefined = contextNetwork
    ? {
        waitReady: () =>
          fromPromise(
            contextNetwork.ready,
            (cause): RadioError => ({ kind: 'network-offline', reason: String(cause) }),
          ),
      }
    : undefined

  const radio: RadioPlaybackPort | undefined = contextRadio
    ? {
        start: (options) =>
          fromPromise(
            contextRadio.start({
              url: options.url,
              sampleRate: options.sampleRate,
              reconnect: options.reconnect,
              onStateChanged: options.onStateChanged,
            }),
            (cause): RadioError => ({ kind: 'playback-failed', reason: String(cause) }),
          ),
        stop: () => contextRadio.stop(),
      }
    : undefined

  const ui: RadioUiPort = {
    showNotes() {
      context.ui.addEffect(notes, EFFECT_KEY)
    },
    hideNotes() {
      context.ui.removeEffect(notes)
    },
    setConnectionIndicator(visible) {
      context.ui.setConnectionIndicator?.(visible)
    },
    setFaceMotionEnabled(enabled) {
      context.ui.setFaceMotionEnabled?.(enabled)
    },
    showBalloon(text) {
      context.ui.showBalloon(text)
    },
    hideBalloon() {
      context.ui.hideBalloon()
    },
    addStationDrawer(options) {
      context.ui.drawer.addDrawerButton({
        key: options.key,
        label: options.label,
        kind: 'choice',
        value: options.value,
        options: options.options,
        callback: (_nextContext, value) => {
          if (value) options.onSelect(value)
        },
      })
    },
    removeStationDrawer(key) {
      context.ui.drawer.removeDrawerButton(key)
    },
  }

  return {
    stations,
    network,
    radio,
    ui,
  }
}
