import { createGuruguruView } from 'guruguru-view'
import { hasGeminiSpeechKey, hasOpenAISpeechKey } from 'muse-account-cascaded'
import { captionBounds, captionLineWidths } from 'muse-caption-layout'
import { createCaptionState } from 'muse-caption-state'
import * as diagnosticHeap from 'muse-diagnostic-heap'
import Modules from 'modules'
import nativeGeminiTransport from 'muse-native-speech-enabled'
import { createPairingPeripheral } from 'muse-pairing/peripheral'
import PairingNative, { AccountSession, pairingSelftest } from 'muse-pairing-native'
import { createResponseExpressionController } from 'muse-response-expression'
import { isConnectionDiagnostic } from 'muse-setup/conversation-owner'
import { createSetupConversationRuntime } from 'muse-setup/conversation-runtime'
import { createSetupCoordinator } from 'muse-setup/coordinator'
import { createPairingController } from 'muse-setup/pairing-controller'
import { describeSetupPrompt } from 'muse-setup/prompt'
import metadata from 'muse-setup-metadata'
import { createSpeechDiagnostics } from 'muse-speech-diagnostics'
import { createSpeechProfile } from 'muse-speech-profile'
import { createSpeechProvider, geminiSpeechVoices } from 'muse-speech-provider'
import { attachTalkButtons, createTalkControls } from 'muse-talk-controls'
import { createTalkFeedback, savedStatusBounds, setupActions, voiceMenuAvailable } from 'muse-talk-feedback'
import { Application, Behavior, Container, Label, Port, Skin, Style, Text } from 'piu/MC'
import Preference from 'preference'
import Timer from 'timer'
import Time from 'time'

const diagnostics = createSpeechDiagnostics({ timer: Timer, heap: diagnosticHeap, emit: (value) => trace(value) })

let identity,
  switching = false,
  disposed = false,
  controller,
  coordinator,
  action,
  pairing = { phase: 'idle', canStart: true },
  blocked = false,
  held = false,
  connectionFailure,
  physicalButtons,
  speechBusy = false
const speechProfile = createSpeechProfile({
  read: () => Preference.get('ai', 'speechVoice'),
  write: (voice) => Preference.set('ai', 'speechVoice', voice),
})
const geminiProfile = createSpeechProfile({
  read: () => Preference.get('ai', 'geminiVoice'),
  write: (voice) => Preference.set('ai', 'geminiVoice', voice),
  voices: geminiSpeechVoices,
})
const speechProvider = createSpeechProvider({
  read: () => Preference.get('ai', 'speechProvider'),
  write: (provider) => Preference.set('ai', 'speechProvider', provider),
  hasGeminiKey: hasGeminiSpeechKey,
})
const selectedProfile = () => (speechProvider.current() === 'gemini' ? geminiProfile : speechProfile)
const providerLabel = () => `Speech: ${speechProvider.current() === 'gemini' ? 'Gemini' : 'OpenAI'}`
const style = new Style({ font: '18px Open Sans', color: 'white', horizontal: 'center' })
const feedback = createTalkFeedback()
const captionSkin = new Skin({ fill: '#101820' })
const userCaptionStyle = new Style({ font: 'k8x12-24', color: '#9eead9', horizontal: 'left' })
const museCaptionStyle = new Style({ font: 'k8x12-24', color: 'white', horizontal: 'center' })
const captionRows = captionLineWidths.map(
  (width, index) =>
    new Label(null, {
      left: (442 - width) / 2,
      width,
      top: index * 28,
      height: 28,
      style: museCaptionStyle,
      string: '',
      skin: captionSkin,
      visible: false,
    }),
)
const waiting = new Label(null, {
  left: 162,
  right: 162,
  top: 410,
  height: 20,
  style,
  string: '',
  visible: false,
})
let captionMode = false
const statusText = new Text(null, { left: 0, right: 0, top: 0, bottom: 0, style, string: 'Checking setup...' })
const status = new Container(null, {
  left: 90,
  right: 90,
  top: 90,
  height: 174,
  clip: true,
  contents: [statusText, ...captionRows],
})
Object.defineProperty(status, 'string', {
  get() {
    return statusText.string
  },
  set(value) {
    statusText.string = value
  },
})
const captions = createCaptionState({
  measure: (text) => museCaptionStyle.measure(text).width,
  timer: Timer,
  now: () => Time.ticks,
  render(value) {
    captionRows.forEach((row, index) => {
      const text = value.lines[index] ?? ''
      if (row.string !== text) row.string = text
      const style = value.speaker === 'user' ? userCaptionStyle : museCaptionStyle
      if (row.style !== style) row.style = style
      row.visible = captionMode && Boolean(text)
    })
    waiting.string = value.waiting
      ? 'Muse...'
      : value.phase === 'recording'
        ? 'Recording'
        : value.phase === 'idle'
          ? 'Hold A to talk'
          : ''
    waiting.visible = captionMode && Boolean(waiting.string)
  },
})
class Action extends Behavior {
  onTouchBegan(content, id, x, y, ticks) {
    content.captureTouch(id, x, y, ticks)
    this.pending = action
  }
  onTouchEnded() {
    const call = this.pending
    this.pending = undefined
    connectionFailure = undefined
    if (call)
      Promise.resolve()
        .then(call)
        .catch(() => {
          status.string = connectionFailure ?? 'Operation not completed. Check setup and retry.'
        })
  }
  onTouchCancelled() {
    this.pending = undefined
  }
}
class Host extends Behavior {
  onQuit() {
    disposed = true
    captions.close()
    diagnostics.close()
    controls.close()
    physicalButtons?.close()
    view.close()
    Promise.resolve(controller ? controller.close() : coordinator?.close()).catch(() => {})
  }
}
const button = new Label(null, {
  left: 120,
  right: 120,
  bottom: 80,
  height: 48,
  style,
  skin: new Skin({ fill: '#24585d' }),
  string: 'Wait',
  active: true,
  Behavior: Action,
})
class Talk extends Behavior {
  onTouchBegan(content, id, x, y, ticks) {
    if (switching || disposed) return
    if (coordinator?.snapshot().phase === 'saved' && identity?.sdkReady) {
      content.captureTouch(id, x, y, ticks)
      this.repair = coordinator
      return
    }
    if (coordinator?.snapshot().phase !== 'connected') return
    content.captureTouch(id, x, y, ticks)
    controls.press('touch')
  }
  onTouchEnded() {
    const previous = this.repair
    this.repair = undefined
    if (previous) {
      void startPairingAgain(previous).catch(() => {
        status.string = 'Could not restart setup. Restart this app.'
      })
      return
    }
    controls.release('touch')
  }
  onTouchCancelled() {
    this.repair = undefined
    controls.disconnect()
  }
}
const talk = new Label(null, {
  ...setupActions.pairing,
  style: museCaptionStyle,
  skin: new Skin({ fill: '#24585d' }),
  string: 'Hold to talk',
  active: true,
  visible: false,
  Behavior: Talk,
})
function canChooseVoice() {
  return voiceMenuAvailable(
    coordinator?.snapshot().phase,
    identity?.sdkReady,
    held || speechBusy || switching || disposed || blocked,
  )
}
class ChooseVoice extends Behavior {
  onTouchBegan(content, id, x, y, ticks) {
    this.allowed = canChooseVoice()
    if (this.allowed) content.captureTouch(id, x, y, ticks)
  }
  onTouchEnded(content) {
    if (!this.allowed || !canChooseVoice()) return
    this.allowed = false
    try {
      content.string = `Voice: ${selectedProfile().next()}`
    } catch {
      status.string = 'Voice not saved. Try again.'
    }
  }
  onTouchCancelled() {
    this.allowed = false
  }
}
const voiceChoice = new Label(null, {
  ...setupActions.voice,
  style,
  skin: new Skin({ fill: '#24585d' }),
  string: `Voice: ${selectedProfile().current()}`,
  visible: false,
  active: false,
  Behavior: ChooseVoice,
})
class ChooseProvider extends Behavior {
  onTouchBegan(content, id, x, y, ticks) {
    this.allowed = canChooseVoice()
    if (this.allowed) content.captureTouch(id, x, y, ticks)
  }
  onTouchEnded(content) {
    if (!this.allowed || !canChooseVoice()) return
    this.allowed = false
    try {
      speechProvider.next()
      content.string = providerLabel()
      voiceChoice.string = `Voice: ${selectedProfile().current()}`
      status.string = 'Speech provider saved. Connect to use it.'
    } catch (error) {
      status.string =
        error.code === 'gemini_key_missing'
          ? 'Gemini API key needed. Speech provider unchanged.'
          : 'Speech provider not saved. Try again.'
    }
  }
  onTouchCancelled() {
    this.allowed = false
  }
}
const providerChoice = new Label(null, {
  ...setupActions.provider,
  style,
  skin: new Skin({ fill: '#24585d' }),
  string: providerLabel(),
  visible: false,
  active: false,
  Behavior: ChooseProvider,
})
class InputMeter extends Behavior {
  onTimeChanged(port) {
    const width = Math.round(110 * feedback.snapshot().level)
    if (width === this.width) return
    this.width = width
    port.invalidate(40, 16, 110, 14)
  }
  onDraw(port) {
    const value = feedback.snapshot().level
    port.fillColor('#101820', 0, 0, port.width, port.height)
    port.fillColor('white', 12, 5, 10, 20)
    port.fillColor('white', 7, 19, 3, 10)
    port.fillColor('white', 24, 19, 3, 10)
    port.fillColor('white', 7, 29, 20, 3)
    port.fillColor('white', 15, 32, 4, 6)
    port.fillColor('white', 10, 38, 14, 3)
    port.fillColor('#40515c', 40, 16, 110, 14)
    port.fillColor('#67e2b1', 40, 16, Math.round(110 * value), 14)
  }
}
const inputMeter = new Port(null, {
  left: 153,
  width: 160,
  top: 124,
  height: 46,
  interval: 100,
  visible: false,
  Behavior: InputMeter,
})
function updateFeedback() {
  const state = feedback.snapshot()
  inputMeter.visible = state.recording
  if (state.recording) inputMeter.start()
  else inputMeter.stop()
  inputMeter.invalidate()
  speechBusy = state.busy
  voiceChoice.active = canChooseVoice()
  providerChoice.active = canChooseVoice()
}
const view = createGuruguruView()
const responseExpression = createResponseExpressionController((expression) => view.model.setExpression(expression))
view.content.visible = false
const runtime = createSetupConversationRuntime(
  (event) => {
    if (disposed) return
    diagnostics.event(event)
    captions.event(event)
    if (event.type === 'caption.segment' || event.type === 'caption.duration') return
    if (event.type === 'input.transcript' && event.value.final) captions.transcript(event.value.text)
    if (event.type === 'output.level' && event.value > 0) captions.audible()
    if (event.type === 'error') {
      const code = [
        'deadline_exceeded',
        'resource_exhausted',
        'input_overrun',
        'provider_failed',
        'cancelled',
        'cancelled_unconfirmed',
        'unsupported_capability',
        'device_busy',
      ].includes(event.code)
        ? event.code
        : 'unknown'
      trace(`MUSE_SPEECH error ${code}\n`)
    }
    responseExpression.handle(event)
    feedback.event(event)
    if (event.type === 'input.level' || event.type === 'output.level') return
    updateFeedback()
    if (event.type === 'session.ended') {
      speechBusy = false
      controls.reset()
      view.model.setState('idle')
      coordinator?.connectionEnded()
    } else if (event.type === 'turn.started') {
      speechBusy = true
      view.model.setState('think')
    } else if (event.type === 'turn.ended') {
      speechBusy = false
      view.model.setState('idle')
    } else if (event.type === 'error' && !event.fatal) {
      speechBusy = false
      captions.error(event.code === 'input_overrun' ? '短く話してください' : 'もう一度お話しください')
      view.model.setState('idle')
    } else if (event.type === 'error' && event.fatal) {
      speechBusy = false
      view.model.setState('idle')
      connectionFailure = 'Conversation stopped. Reconnect to Muse.'
      captions.error('会話を終了しました')
      Promise.resolve(runtime.endCall())
        .finally(() => coordinator?.connectionEnded())
        .catch(() => {})
    }
  },
  async (value) => {
    const sent = await controller?.reportProgress(value)
    if (controller && value === 'auth_ok') trace(sent ? 'MUSE_PAIR auth_ok_sent\n' : 'MUSE_PAIR auth_ok_not_sent\n')
  },
  (value) => {
    if (typeof value === 'string' && /^stt_timing_[0-9]{1,6}(?:_[0-9]{1,10}){4}$/.test(value))
      trace(`MUSE_SPEECH ${value}\n`)
    if (typeof value === 'string' && /^tts_worker_(?:start|allocation_failed|spawned|dispatch|error|done)$/.test(value)) trace(`MUSE_SPEECH ${value}\n`)
    if (typeof value === 'string' && /^tts_transport_[0-9]{1,10}(?:_[0-9]{1,10}){9}$/.test(value))
      trace(`MUSE_SPEECH ${value}\n`)
    if (typeof value === 'string' && /^tts_failure_(?:[0-9]|1[0-3])$/.test(value)) trace(`MUSE_SPEECH ${value}\n`)
    if (typeof value === 'string' && /^tts_metrics_[0-9]{1,6}_[0-9]{1,8}$/.test(value)) {
      trace(`MUSE_SPEECH ${value}\n`)
      diagnostics.event({ type: 'tts.metrics' })
    }
    if (value === 'openai_key_missing') connectionFailure = 'OpenAI API key needed. Pairing is saved.'
    if (value === 'gemini_key_missing') connectionFailure = 'Gemini API key needed. Pairing is saved.'
    if (value === 'openai_key_missing' || value === 'cascaded_chat_ready') trace(`MUSE_CONNECT ${value}\n`)
    if (value === 'bridge_response_404') connectionFailure = 'Muse voice returned HTTP 404. Pairing is saved.'
    if (
      isConnectionDiagnostic(value) ||
      /^note_(subscription_body|subscription_end|reset_received|reply_event|transport_closed|transport_reason_(?:[0-9]|1[0-9]|2[0-3])|connect_open_[0-7]|connect_(?:start|handshake)_failed|chat_ready|upload_start|reply_complete|stage_(upload|playback)|failed_(upload|playback)|error_(resource_exhausted|deadline_exceeded|device_busy|cancelled|provider_failed|unknown)|http_[1-5][0-9]{2}|post_begin|upload_complete|ack_received)$/.test(
        value,
      )
    )
      trace(`MUSE_CONNECT ${value}\n`)
  },
  {
    getSpeechVoice: speechProfile.current,
    nativeGeminiTransport,
    geminiSampleRate: 24000,
    getGeminiVoice: geminiProfile.current,
    getSpeechProvider: speechProvider.current,
    onPlaybackState(active, info) {
      if (disposed) return
      if (active) {
        if (!captions.prepare(info?.outputId, info?.turnId)) return
      } else if (!captions.stopOutput(info)) return
      feedback.playback(active)
      updateFeedback()
      view.model.setState(active ? 'speak' : 'idle')
    },
  },
)
const canTalk = () => !disposed && !switching && coordinator?.snapshot().phase === 'connected'
const controls = createTalkControls({
  canTalk,
  canStart: () => canTalk() && !speechBusy,
  setMuted: (value) => runtime.mute(value),
  async disconnect() {
    captions.clear()
    await runtime.endCall()
    coordinator?.connectionEnded()
  },
  onHeld(value) {
    held = value
    feedback.hold(value)
    updateFeedback()
    captions.input(value)
    view.model.setState(value ? 'listen' : 'think')
  },
  onError(stage) {
    feedback.reset()
    updateFeedback()
    view.model.setState('idle')
    captions.error(stage === 'disconnect' ? '切断をやり直してください' : 'マイクを確認してください')
  },
})
try {
  physicalButtons = attachTalkButtons(device.peripheral.button, controls)
} catch {
  trace('MUSE_BUTTONS unavailable\n')
}
const app = new Application(null, {
  skin: new Skin({ fill: 'black' }),
  displayListLength: 4096,
  touchCount: 1,
  Behavior: Host,
})
globalThis.application = app
app.add(view.content)
app.add(status)
app.add(button)
app.add(talk)
app.add(voiceChoice)
app.add(providerChoice)
app.add(inputMeter)
app.add(waiting)
function render() {
  action = undefined
  if (blocked || switching || disposed) return
  const state = coordinator?.snapshot()
  const connected = state?.phase === 'connected'
  if (!connected) {
    feedback.reset()
    updateFeedback()
  }
  voiceChoice.visible = voiceMenuAvailable(state?.phase, identity?.sdkReady)
  voiceChoice.active = canChooseVoice()
  providerChoice.visible = voiceChoice.visible
  providerChoice.active = canChooseVoice()
  if (captionMode && !connected) captions.clear()
  captionMode = connected
  statusText.visible = !connected
  if (!connected) {
    captionRows.forEach((row) => {
      row.visible = false
    })
    waiting.visible = false
  }
  talk.visible = state?.phase === 'saved' && identity?.sdkReady === true
  talk.active = talk.visible
  button.visible = !connected
  button.active = !connected
  talk.string = 'ペアリング'
  const saved = state?.phase === 'saved'
  button.coordinates = saved ? setupActions.connect : { left: 120, right: 120, bottom: 80, height: 48 }
  view.content.visible = connected
  status.coordinates = connected
    ? captionBounds
    : saved
      ? savedStatusBounds
      : { left: 90, right: 90, top: 90, height: 174 }
  if (state?.phase === 'review') {
    status.string = 'Save Wi-Fi and Muse credentials here? Protection follows device settings. This does not connect.'
    button.string = 'Save on device'
    action = describeSetupPrompt(coordinator).confirm
  } else if (state?.phase === 'saved') {
    status.string = connectionFailure ?? 'Connect with saved settings. Pairing changes require approval.'
    button.string = 'Connect to Muse'
    action = describeSetupPrompt(coordinator).confirm
  } else if (state?.phase === 'connected') {
    waiting.string = 'Hold A to talk'
    waiting.visible = true
    button.string = 'Disconnect'
    action = () => controls.disconnect()
  } else if (state?.phase === 'saving' || state?.phase === 'connecting') {
    status.string = 'Working...'
    button.string = 'Wait'
  } else if (pairing.canConfirm) {
    status.string = 'Confirm the request you started in Muse. Community pairing has no manufacturer attestation.'
    button.string = 'Confirm pairing'
    action = () => controller.confirmPhysical()
  } else if (pairing.canStart) {
    status.string = 'Phone ready? Start Bluetooth pairing. Credentials are saved only after you approve.'
    button.string = 'Start pairing'
    action = () => controller.start()
  } else {
    const labels = {
      starting: 'Starting Bluetooth...',
      advertising: `Choose ${pairing.name} in the Muse app.`,
      waiting: 'Pairing confirmed. Waiting for phone configuration.',
      disconnected: 'Phone disconnected. Restart this setup app to retry.',
      failed: 'Pairing failed. Restart this setup app to retry.',
      confirming: 'Confirming pairing...',
    }
    status.string = labels[pairing.phase] ?? 'Waiting for setup...'
    button.string = 'Wait'
  }
}
function makeController(info) {
  return createPairingController({
    identity: info,
    setupComplete: false,
    coordinator,
    createNative: (identity) => new PairingNative(identity),
    createPeripheral: createPairingPeripheral,
    createAccount: (native, generation) => runtime.wrap(new AccountSession(native, generation), info),
    onChange(state) {
      pairing = state
      render()
    },
  })
}
async function startPairingAgain(previous) {
  if (disposed || switching || coordinator !== previous || previous.snapshot().phase !== 'saved' || !identity?.sdkReady)
    return
  switching = true
  action = undefined
  talk.visible = false
  button.string = 'Wait'
  status.string = 'Closing the old account. Saved settings stay unchanged.'
  try {
    await (controller ? controller.close() : previous.close())
    if (disposed) return
    controller = undefined
    coordinator = createSetupCoordinator({ onChange: render })
    pairing = { phase: 'idle', canStart: true }
    controller = makeController(identity)
    switching = false
    controller.start()
    render()
  } catch {
    blocked = true
    button.string = 'Unavailable'
    throw new Error('pairing_restart_failed')
  } finally {
    switching = false
  }
}
try {
  const checks = pairingSelftest()
  trace(checks.counter ? 'MUSE_TEST counter_pass\n' : 'MUSE_TEST counter_fail\n')
  trace(checks.crypto ? 'MUSE_TEST crypto_pass\n' : 'MUSE_TEST crypto_fail\n')
  if (!checks.counter || !checks.crypto) throw new Error('pairing selftest failed')
  const info = metadata()
  identity = info
  trace(info.sdkReady ? 'MUSE_SETUP sdk_present\n' : 'MUSE_SETUP sdk_absent\n')
  trace(`MUSE_SETUP cascaded_${speechProvider.current()}_speech\n`)
  trace(hasOpenAISpeechKey() ? 'MUSE_SETUP openai_key_present\n' : 'MUSE_SETUP openai_key_absent\n')
  trace(hasGeminiSpeechKey() ? 'MUSE_SETUP gemini_key_present\n' : 'MUSE_SETUP gemini_key_absent\n')
  trace(
    speechProvider.current() === 'gemini'
      ? 'MUSE_SETUP gemini_worker_selected\n'
      : 'MUSE_SETUP openai_speech_selected\n',
  )
  coordinator = createSetupCoordinator({ onChange: render })
  if (Modules.has('muse-stopwatch-rate-fixture')) {
    blocked = true
    button.string = 'Diagnostics'
    status.string = 'Offline audio diagnostics'
    trace('MUSE_RATE_APP_READY\n')
    try {
      Modules.importNow('muse-stopwatch-rate-fixture', true).arm({
        active: () => !disposed && !switching && !held && !speechBusy,
        onDone: () => {
          if (!disposed) status.string = 'Offline audio diagnostics finished.'
        },
      })
    } catch {
      trace('MUSE_RATE_INIT_FAILED\n')
      status.string = 'Offline audio diagnostics unavailable.'
    }
  } else if (info.setupComplete && !physicalButtons?.startupBPressed) {
    const stored = AccountSession.restore()
    coordinator.acceptStored(runtime.wrap(stored, info), stored.generation)
    if (info.sdkReady) {
      const startup = coordinator
      void Promise.resolve()
        .then(() => {
          if (disposed || switching || coordinator !== startup || startup.snapshot().phase !== 'saved') return
          return describeSetupPrompt(startup).confirm()
        })
        .catch(() => {
          if (!disposed && coordinator === startup)
            status.string = connectionFailure ?? 'Could not connect. Retry or start pairing again.'
        })
    }
  } else if (!info.sdkReady) {
    blocked = true
    status.string = 'Muse SDK token needed. Use the private USB setup tool first.'
    button.string = 'SDK token needed'
  } else {
    controller = makeController(info)
    render()
  }
  trace('MUSE_SETUP ready radio_not_started\n')
} catch {
  blocked = true
  action = undefined
  status.string = 'Setup state unavailable. Nothing started.'
  button.string = 'Unavailable'
}
