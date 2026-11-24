import type { StackchanContext } from 'capabilities'
import { ChatStatusBarState } from 'chat-status-bar'
import { localize } from 'localization'
import config from 'mc/config'
import Modules from 'modules'
import { Style } from 'piu/MC'
import { RollingTextLines } from 'rolling-text-lines'
import { UI } from 'ui-theme'
import type { createMuseConversationControl, MuseConversationState } from '../../modules/muse-gadget/host-control.js'

export function installMuseConversationUI(robot: StackchanContext): (() => Promise<void>) | undefined {
  if (!Modules.has('stackchan/muse-conversation')) return
  const microphone = robot.audio.microphone
  if (!microphone) return
  const provider = Modules.importNow('stackchan/muse-conversation', true) as {
    createMuseConversationControl: typeof createMuseConversationControl
  }
  const speaker = robot.audio.speaker
  const app = robot.ui.application as { distribute?(event: string, ...values: unknown[]): void } | undefined
  const style = new Style({ font: 'k8x12-12' })
  const captions = new RollingTextLines({
    rows: 3,
    width: UI.screenWidth - 72,
    measure: (character) => style.measure(character).width ?? 0,
  })
  const captionOptions =
    UI.faceViewport.height > UI.screenHeight ? { top: UI.touchTarget, paddingY: UI.space } : undefined
  const drawCaption = (text: string) => {
    const lines = captions.append(text)
    robot.ui.showBalloonLines?.(lines, captionOptions)
  }
  let talking = false
  let phase: MuseConversationState['phase'] = 'idle'
  const setTalking = (pressed: boolean) => {
    if (pressed) {
      if (phase !== 'ready' || talking) return
      talking = true
    } else {
      if (!talking) return
      talking = false
    }
    void control.setTalking(pressed).catch(reportError)
  }
  const reportError = () => {
    trace('[muse] action failed\n')
    robot.showBalloon(localize('muse.failed'))
  }
  const whenOnline = async (callback: () => Promise<boolean>) => {
    const network = await robot.connectivity.network?.ready
    if (network?.status !== 'connected') {
      robot.showBalloon(localize('muse.wifiRequired'))
      return
    }
    await callback()
  }
  const action = (key: string, label: string, callback: () => Promise<unknown>) => {
    robot.drawer.addDrawerButton({
      key,
      label: localize(label),
      callback: () => {
        robot.ui.closeDrawer()
        return callback().catch(reportError)
      },
    })
  }
  const showIdleActions = () => {
    action('museConversation', 'muse.start', () => whenOnline(() => control.start()))
    action('musePairing', 'muse.pair', () => control.startPairing())
  }
  const control = provider.createMuseConversationControl({
    microphone,
    speaker,
    volume: robot.audio.volume,
    onEvent(event) {
      switch (event.type) {
        case 'input.level':
          app?.distribute?.('onChatInputLevel', event.value * 32768)
          break
        case 'output.level':
          robot.setMouthOpen(Math.max(0, Math.min(1, event.value * 4)), true)
          break
        case 'input.transcript':
          if (event.value.final && event.value.text) {
            captions.clear()
            drawCaption(event.value.text)
          }
          break
        case 'turn.started':
          captions.clear()
          break
        case 'output.text':
          drawCaption(event.delta)
          break
        case 'turn.ended':
          robot.setMouthOpen(0, true)
          break
      }
    },
    onState(state) {
      const previous = phase
      phase = state.phase
      const active = phase === 'ready' || phase === 'listening' || phase === 'thinking' || phase === 'speaking'
      if (active && previous === 'connecting') {
        app?.distribute?.('onPushToTalk', setTalking)
        action('museConversation', 'muse.end', () => control.end())
        robot.hideBalloon()
      }
      if (!active) {
        talking = false
        robot.setMouthOpen(0, true)
        app?.distribute?.('onPushToTalk', undefined)
      }
      const states: Partial<Record<MuseConversationState['phase'], ChatStatusBarState>> = {
        connecting: ChatStatusBarState.CONNECTING,
        ready: ChatStatusBarState.CONNECTED,
        listening: ChatStatusBarState.SPEAKING,
        thinking: ChatStatusBarState.WAITING,
        speaking: ChatStatusBarState.LISTENING,
        failed: ChatStatusBarState.FAILED,
      }
      app?.distribute?.('onChatState', states[phase] ?? ChatStatusBarState.DISCONNECTED)
      switch (phase) {
        case 'connecting':
          robot.drawer.removeDrawerButton('musePairing')
          action('museConversation', 'muse.end', () => control.end())
          robot.showBalloon(localize('muse.connecting'))
          break
        case 'idle':
          robot.drawer.removeDrawerButton('museCancelPairing')
          robot.hideBalloon()
          showIdleActions()
          break
        case 'unpaired':
          showIdleActions()
          robot.showBalloon(localize(state.sdkReady ? 'muse.pairRequired' : 'muse.sdkTokenRequired'))
          break
        case 'failed':
          showIdleActions()
          robot.showBalloon(localize(state.error === 'gemini_key_missing' ? 'muse.geminiTokenRequired' : 'muse.failed'))
          break
        case 'pairing':
        case 'confirm':
        case 'review':
          robot.drawer.removeDrawerButton('museConversation')
          robot.drawer.removeDrawerButton('musePairing')
          action('museCancelPairing', 'muse.cancel', () => control.cancelPairing())
          if (phase === 'confirm') action('musePairing', 'muse.confirm', () => control.confirmPairing())
          if (phase === 'review') action('musePairing', 'muse.save', () => whenOnline(() => control.savePairing()))
          robot.showBalloon(localize('muse.pairing', { name: state.name ?? 'Muse' }))
          break
      }
    },
  })
  showIdleActions()
  if (config.talkButton === 'a' && robot.button?.a) {
    robot.button.a.onEvent = (event) => setTalking(event.pressed)
  }
  return () => control.close()
}
