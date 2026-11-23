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
  idle: 'OpenAI ��b���I�����܂���',
  connecting: 'OpenAI �ɐڑ���',
  connected: 'OpenAI ��b��',
  closing: '��b���I����',
  configuration: 'API �L�[��ݒ肵�Ă�������',
  error: '��b�G���[�B������x�J�n���Ă�������',
}

export function onContextCreated(robot) {
  if (!Modules.has('realtimeConversation') || !robot.audio.microphone || !globalThis.amp) {
    robot.ui.showBalloon('OpenAI WebRTC �Ή��z�X�g���K�v�ł�')
    return
  }
  const { LiveConversation } = Modules.importNow('realtimeConversation', true)
  const power = Modules.importNow('network-power')
  const levels = Modules.has('io-performance') ? Modules.importNow('io-performance') : undefined
  const uiPerformance = Modules.has('stackchan/realtime-ui-performance')
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
      robot.ui.showBalloon('�����̉�����m�F�ł��܂���')
    } else if (wakeUnavailable) {
      robot.ui.showBalloon('�E�F�C�N���[�h���J�n�ł��܂���')
    } else if (coordinator.wakeEnabled && coordinator.status === 'listening') {
      robot.ui.showBalloon('�uHi, Stack Chan�v�ŉ�b���J�n')
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
  let releaseUI
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
  function renderConversation(standby) {
    const message = standby
      ? session.active?.muted
        ? 'OpenAI �ҋ@���E�~���[�g��'
        : 'OpenAI �ҋ@���E�}�C�N���M��'
      : standby === undefined && coordinator
        ? '�b�������Ă�������'
        : messages.connected
    try {
      robot.ui.showBalloon(message)
    } catch {
      // A display failure must not end the conversation.
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
    acquireLowLatency: () => power.acquireLowLatency(),
    settings,
    reactions: settings.decisionsReactions === true ? createDecisionsReactions(robot, wait) : undefined,
    onStandbyChanged: renderConversation,
    onState(state, standby) {
      const active = ['connecting', 'connected', 'closing'].includes(state)
      try {
        if (state === 'connected' && !releaseUI) releaseUI = uiPerformance?.acquire()
        else if (!active && releaseUI) {
          const release = releaseUI
          releaseUI = undefined
          release()
        }
      } catch {
        trace('[openai-live] realtime UI scheduling failed\n')
      }
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
        if (state === 'connected') renderConversation(standby)
        else robot.ui.showBalloon(messages[state])
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
        label: '�E�F�C�N���[�h�ҋ@',
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
    label: 'OpenAI ��b',
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
    label: '�}�C�N�~���[�g',
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
      const entry = session.active
      const muted = !entry?.muted
      void session.setMicrophoneMuted(muted).then((value) => {
        changingMute = false
        if (session.active !== entry) return
        drawer.setDrawerButtonState(MUTE, value)
        if (entry?.connected && !entry.cancelled && entry.standby) renderConversation(true)
      })
    },
  })
}

export function onClose() {
  return stopWake ? stopWake() : session?.stop()
}
