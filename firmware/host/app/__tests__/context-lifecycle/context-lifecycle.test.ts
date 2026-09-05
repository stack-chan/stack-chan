import { createAppControllerApplication } from 'app-controller'
import { SimpleFace } from 'behaviors/face'
import { NoneDriver } from 'none-driver'
import { StackchanRuntimeContext } from 'runtime-context'
import { defineApp } from 'stackchan'
import { assert, equal } from 'testing/assert'

async function run() {
  let previousCalls = 0
  let presses = 0
  let tones = 0
  let cancellations = 0
  let finishTone: (() => void) | undefined
  const previous = () => {
    previousCalls += 1
  }
  const rawButton = { read: () => 1, onChanged: previous }
  const context = new StackchanRuntimeContext({
    driver: new NoneDriver(),
    ui: createAppControllerApplication({ face: new SimpleFace() }),
    tts: {
      stream(_text, _volume, callback) {
        callback?.()
      },
    },
    speaker: {
      tone() {
        tones += 1
        return new Promise<void>((resolve) => {
          finishTone = resolve
        })
      },
      async play() {
        return true
      },
      cancelPlayback() {
        cancellations += 1
      },
    },
    button: { a: rawButton },
  })
  await context.startApp(
    defineApp({
      setup(app) {
        app.input.onPress('primary', async () => {
          presses += 1
          await app.audio.tone(440, { durationMs: 100 })
        })
      },
    }),
  )
  const installed = rawButton.onChanged
  installed.call(rawButton)
  installed.call(rawButton)
  for (let turn = 0; turn < 8; turn += 1) await Promise.resolve()
  equal(presses, 1, 'primary handler is serialized')
  equal(tones, 1, 'public tone reaches the host audio runtime')
  const close = context.lifecycle.close()
  equal(close, context.lifecycle.close(), 'host close shares its completion')
  await close
  equal(cancellations, 1, 'app close reaches active speaker operation')
  equal(rawButton.onChanged, previous, 'host restores the raw button handler')
  installed.call(rawButton)
  equal(presses, 1, 'late input cannot reach closed app')
  finishTone?.()
  await Promise.resolve()
  rawButton.onChanged()
  equal(previousCalls, 1, 'previous owner receives subsequent input')
  try {
    await context.startApp(defineApp({ setup() {} }))
    assert(false, 'a closed host cannot start another app')
  } catch (error) {
    equal((error as { code?: string }).code, 'CLOSED', 'closed host has a stable failure code')
  }
  trace('ok\n')
}

run().catch((error) => {
  trace(`context lifecycle failed: ${error}\n`)
  throw error
})
