import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { GuruguruAvatar } from './avatar.js'

test('PTT, pipeline events, lip level, stop and teardown use public APIs', async () => {
  const calls = []
  const avatar = new GuruguruAvatar()
  let events
  const scope = {
    signal: {},
    abort() {
      calls.push('abort')
    },
  }
  const pipeline = {
    async start() {},
    async close() {
      calls.push('close')
    },
    setVolume() {},
  }
  const factory = { create: () => ({}) }
  const modules = {
    'guruguru-view': {
      createGuruguruView: () => ({
        model: avatar,
        content: {},
        close() {
          calls.push('view.close')
        },
      }),
    },
    'stackchan/ai': { Agent: factory, OpenAIResponsesLLM: factory, ToolSet: factory },
    'stackchan/voice/speech': { OpenAISpeechTTS: factory, WhisperSTT: factory },
    'stackchan/voice': {
      CascadedConversation: factory,
      VoiceScope: { create: () => scope },
      PushToTalk: {
        create: () => ({
          detector: {},
          press() {
            calls.push('press')
          },
          release() {
            calls.push('release')
          },
        }),
      },
      ConversationPipeline: {
        create(options) {
          events = options.onEvent
          return pipeline
        },
      },
    },
  }
  const context = vm.createContext({})
  const mod = new vm.SourceTextModule(await readFile(new URL('./mod.js', import.meta.url), 'utf8'), { context })
  await mod.link((name) => {
    const exports = modules[name]
    return new vm.SyntheticModule(
      Object.keys(exports),
      function () {
        for (const [key, value] of Object.entries(exports)) this.setExport(key, value)
      },
      { context },
    )
  })
  await mod.evaluate()
  const oldA = () => {},
    oldB = () => {}
  const robot = {
    input: { button: { a: { onEvent: oldA }, b: { onEvent: oldB } } },
    audio: {},
    ui: {
      addEffect() {},
      removeEffect() {
        calls.push('remove')
      },
      showBalloon() {},
    },
  }
  mod.namespace.onContextCreated(robot, { config: { ai: { token: 'test-not-a-secret' } } })
  robot.input.button.a.onEvent({ pressed: true })
  await new Promise(setImmediate)
  assert.equal(avatar.state, 'listen')
  assert.ok(calls.includes('press'))
  robot.input.button.a.onEvent({ pressed: false })
  events({ type: 'turn.started', turnId: 'one' })
  assert.equal(avatar.state, 'think')
  events({ type: 'output.level', value: 0.1 })
  assert.equal(avatar.state, 'speak')
  assert.ok(avatar.mouth > 0)
  events({ type: 'turn.ended', turnId: 'one' })
  assert.equal(avatar.state, 'idle')
  assert.equal(avatar.mouth, 0)
  robot.input.button.b.onEvent({ pressed: true })
  await new Promise(setImmediate)
  assert.ok(calls.includes('close'))
  await mod.namespace.onClose()
  assert.equal(robot.input.button.a.onEvent, oldA)
  assert.equal(robot.input.button.b.onEvent, oldB)
  assert.ok(calls.includes('view.close'))
  assert.ok(calls.includes('remove'))
})
