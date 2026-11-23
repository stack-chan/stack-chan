import Modules from 'modules'
import { createDecisionsReactions } from 'openai-live-decisions-reactions'
import { LiveSession } from 'openai-live-session'
import { openLocalWake } from 'openai-live-wake-audio'
import { ConversationPipeline, VoiceScope } from 'stackchan/voice'
import { wait } from 'stackchan-util'
import Timer from 'timer'

const SESSION = 'openai-live:session'
const MUTE = 'openai-live:mute'
const WAKE = 'openai-live:wake'
let session, stopWake
const messages = {
  idle: 'OpenAI 会話を終了しました',
  connecting: 'OpenAI に接続中',
  connected: 'OpenAI 会話中',
  closing: '会話を終了中',
  configuration: 'API キーを設定してください',
  error: '会話エラー。もう一度開始してください',
}

export function onContextCreated(robot) {
  if (!Modules.has('realtimeConversation') || !robot.audio.microphone || !globalThis.amp) {
    robot.ui.showBalloon('OpenAI WebRTC 対応ホストが必要です')
    return
  }
  const { LiveConversation } = Modules.importNow('realtimeConversation', true)
  const hasRealtimePerformance = typeof robot.conversation?.openRealtimePerformance === 'function'
  const power = !hasRealtimePerformance && Modules.has('network-power') ? Modules.importNow('network-power') : undefined
  const levels = Modules.has('io-performance') ? Modules.importNow('io-performance') : undefined
  const uiPerformance =
    !hasRealtimePerformance && Modules.has('stackchan/realtime-ui-performance')
      ? Modules.importNow('stackchan/realtime-ui-performance')
      : undefined
  const drawer = robot.ui.drawer
  const settings = (Modules.has('mod/config') ? Modules.importNow('mod/config').openaiLive : undefined) ?? {}
  const microphone = robot.audio.microphone
  const networkReady = robot.connectivity.network?.ready
  const speaker = robot.audio.speaker
  let coordinator
  let wakeUnavailable = false
  let manualPending = false
  let disposed = false
  function renderWake() {
    if (disposed || !coordinator) return
    if (coordinator.status === 'fault') {
      robot.ui.showBalloon('音声の解放を確認できません')
    } else if (wakeUnavailable) {
      robot.ui.showBalloon('ウェイクワードを開始できません')
    } else if (coordinator.wakeEnabled && coordinator.status === 'listening') {
      robot.ui.showBalloon('「Hi, Stack Chan」で会話を開始')
    }
    drawer.setDrawerButtonState(WAKE, coordinator.wakeEnabled)
  }
  function afterWake(task) {
    // Render opt-in immediately; a listening balloon still requires acquired audio.
    if (!disposed && coordinator) {
      try {
        drawer.setDrawerButtonState(WAKE, coordinator.wakeEnabled)
      } catch {}
    }
    // A rendering error must not stop serialized audio handoff and teardown.
    void Promise.resolve(task)
      .then(renderWake)
      .catch(() => {})
  }
  function stopListening() {
    afterWake(coordinator.disable())
  }
  let changingMute = false
  let mouthTimer,
    lastMouth = 0
  function updateMouth(value) {
    if (value === lastMouth) return
    lastMouth = value
    try {
      robot.setMouthOpen?.(value, true)
    } catch {
      // A rendering failure must not prevent session cleanup.
    }
  }
  session = new LiveSession({
    createConversation: LiveConversation.create,
    createPipeline: (conversation) =>
      ConversationPipeline.create({
        conversation,
        microphone: robot.audio.microphone,
        speaker: robot.audio.speaker,
        mediaBudget: { maxBufferedBytes: 128 * 1024, maxBufferedMs: 1000 },
      }),
    networkReady,
    openRealtimePerformance: () => {
      if (hasRealtimePerformance) return robot.conversation.openRealtimePerformance()
      const radio = power?.acquireLowLatency()
      let releaseUI
      return {
        connected() {
          releaseUI = uiPerformance?.acquire()
        },
        close() {
          try {
            radio?.close()
          } finally {
            releaseUI?.()
          }
        },
      }
    },
    settings,
    reactions: settings.decisionsReactions === true ? createDecisionsReactions(robot, wait) : undefined,
    onState(state) {
      const active = ['connecting', 'connected', 'closing'].includes(state)
      if (state === 'connected' && mouthTimer === undefined && levels && robot.setMouthOpen) {
        mouthTimer = Timer.repeat(() => {
          const level = levels.levels().referenceLevel ?? 0
          updateMouth(Math.min(10, Math.round(level / 200)) / 10)
        }, 100)
      } else if (state !== 'connected') {
        if (mouthTimer !== undefined) Timer.clear(mouthTimer)
        mouthTimer = undefined
        updateMouth(0)
      }
      try {
        robot.ui.setFaceMotionEnabled?.(!active)
      } catch {
        // Optional face controls must not prevent session cleanup.
      }
      try {
        drawer.setDrawerButtonState(SESSION, active)
        drawer.setDrawerButtonState(MUTE, false)
        robot.ui.showBalloon(coordinator && state === 'connected' ? '話しかけてください' : messages[state])
      } catch {
        // Display failures must not prevent native audio/radio cleanup.
      }
      // Never log credentials, server error bodies, SDP or transcripts.
      trace(`[openai-live] ${state}\n`)
    },
  })
  const canUseWake =
    microphone?.runtime &&
    microphone.runtime === speaker?.runtime &&
    networkReady &&
    typeof settings.apiKey === 'string' &&
    settings.apiKey.trim() &&
    Modules.has('stackchan/voice/wake-conversation') &&
    Modules.has('stackchan/voice/media') &&
    Modules.has('wakeword-wakenet')
  if (canUseWake) {
    try {
      const { createWakeConversation } = Modules.importNow('stackchan/voice/wake-conversation', true)
      const { readSource } = Modules.importNow('stackchan/voice/media', true)
      const live = session
      coordinator = createWakeConversation({
        async openDetector(onWake, scope, onFault) {
          const opening = await openLocalWake(
            {
              microphone,
              speaker,
              createScope: VoiceScope.create,
              createDetector() {
                const { default: WakeNet } = Modules.importNow('wakeword-wakenet', true)
                return new WakeNet()
              },
              readSource,
              onWake() {
                onWake()
                afterWake(coordinator.whenIdle())
              },
              onEnd() {
                wakeUnavailable = true
                onFault()
                afterWake(coordinator.whenIdle())
              },
            },
            scope,
          )
          if (opening.status === 'unavailable' && scope.isCurrent()) {
            wakeUnavailable = true
          }
          return opening
        },
        startConversation(onEnded, scope) {
          manualPending = false
          if (!scope.isCurrent()) return { close() {} }
          return live.startOwned((reason) => {
            onEnded(reason)
            afterWake(coordinator.whenIdle())
          })
        },
      })
      stopWake = () => {
        disposed = true
        return coordinator.shutdown()
      }
      drawer.addDrawerButton({
        key: WAKE,
        label: 'ウェイクワード待機',
        kind: 'toggle',
        initialState: false,
        callback: () => {
          wakeUnavailable = false
          afterWake(coordinator.wakeEnabled ? coordinator.disable() : coordinator.enable())
        },
      })
    } catch {
      // An optional firmware capability cannot replace the established manual path.
      coordinator = undefined
      stopWake = undefined
    }
  } else stopWake = undefined
  drawer.addDrawerButton({
    key: SESSION,
    label: 'OpenAI 会話',
    kind: 'toggle',
    initialState: false,
    callback: () => {
      if (!coordinator) {
        if (session.active) void session.stop()
        else void session.start()
        return
      }
      wakeUnavailable = false
      if (
        session.active ||
        manualPending ||
        ['starting-conversation', 'conversing', 'closing-conversation'].includes(coordinator.status)
      ) {
        manualPending = false
        afterWake(coordinator.stop())
      } else {
        manualPending = true
        const starting = coordinator.startManually()
        afterWake(
          starting.then(() => {
            manualPending = false
          }),
        )
      }
    },
  })
  drawer.addDrawerButton({
    key: MUTE,
    label: 'マイクミュート',
    kind: 'toggle',
    initialState: false,
    callback: () => {
      if (coordinator && !session.active) {
        // Mute must not imply privacy while the local wake detector is listening.
        if (coordinator.wakeEnabled) stopListening()
        drawer.setDrawerButtonState(MUTE, false)
        return
      }
      if (changingMute) return
      changingMute = true
      const muted = !session.active?.muted
      void session.setMicrophoneMuted(muted).then((value) => {
        changingMute = false
        drawer.setDrawerButtonState(MUTE, value)
      })
    },
  })
}

export function onClose() {
  return stopWake ? stopWake() : session?.stop()
}
