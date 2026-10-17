import Modules from 'modules'
import { LiveSession } from 'openai-live-session'

const SESSION = 'openai-live:session'
const MUTE = 'openai-live:mute'
const messages = {
  idle: 'OpenAI 会話を終了しました',
  connecting: 'OpenAI に接続中',
  connected: 'OpenAI 会話中',
  closing: '会話を終了中',
  configuration: 'API キーを設定してください',
  error: '会話エラー。もう一度開始してください',
}

export function onContextCreated(robot) {
  if (!Modules.has('realtimeConversation') || !robot.audio.acquireExclusive || !globalThis.amp) {
    robot.ui.showBalloon('OpenAI WebRTC 対応ホストが必要です')
    return
  }
  const Conversation = Modules.importNow('realtimeConversation')
  const power = Modules.importNow('network-power')
  const drawer = robot.ui.drawer
  let changingMute = false
  const session = new LiveSession({
    Conversation,
    audio: robot.audio,
    networkReady: robot.connectivity.network?.ready,
    acquireLowLatency: () => power.acquireLowLatency(),
    amp: globalThis.amp,
    settings: (Modules.has('mod/config') ? Modules.importNow('mod/config').openaiLive : undefined) ?? {},
    onState(state) {
      try {
        drawer.setDrawerButtonState(SESSION, ['connecting', 'connected', 'closing'].includes(state))
        drawer.setDrawerButtonState(MUTE, false)
        robot.ui.showBalloon(messages[state])
      } catch {
        // Display failures must not prevent native audio/radio cleanup.
      }
      // Never log credentials, server error bodies, SDP or transcripts.
      trace(`[openai-live] ${state}\n`)
    },
  })
  drawer.addDrawerButton({
    key: SESSION,
    label: 'OpenAI 会話',
    kind: 'toggle',
    initialState: false,
    callback: () => {
      if (session.active) void session.stop()
      else void session.start()
    },
  })
  drawer.addDrawerButton({
    key: MUTE,
    label: 'マイクミュート',
    kind: 'toggle',
    initialState: false,
    callback: () => {
      if (changingMute) return
      changingMute = true
      const muted = !session.active?.conversation?.muted
      void session.setMuted(muted).then((value) => {
        changingMute = false
        drawer.setDrawerButtonState(MUTE, value)
      })
    },
  })
}
