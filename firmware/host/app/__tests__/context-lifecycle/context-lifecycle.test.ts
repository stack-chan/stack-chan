import { createAppControllerApplication } from 'app-controller'
import { SimpleFace } from 'behaviors/face'
import { NoneDriver } from 'none-driver'
import { Container } from 'piu/MC'
import { StackchanRuntimeContext } from 'runtime-context'
import { defineApp } from 'stackchan'
import { assert, equal } from 'testing/assert'
import Timer from 'timer'
import TouchPanel from 'touch-panel'

async function rejectsSame(promise: Promise<unknown>, expected: unknown): Promise<void> {
  let rejected = false
  try {
    await promise
  } catch (error) {
    rejected = true
    equal(error, expected, 'initialization error is preserved')
  }
  assert(rejected, 'initialization must reject')
}

async function verifyRollback(stage: 'motion' | 'audio' | 'input' | 'capability'): Promise<void> {
  const failure = new Error(`failed ${stage}`)
  const counts = {
    ui: 0,
    driver: 0,
    detached: 0,
    tts: 0,
    speaker: 0,
    camera: 0,
    input: 0,
    led: 0,
    external: 0,
    frames: 0,
  }
  const ui = createAppControllerApplication({ face: new SimpleFace() })
  const application = ui.application
  const closeUI = ui.close.bind(ui)
  ui.close = () => {
    counts.ui += 1
    closeUI()
    if (stage === 'input') throw new Error('cleanup also failed')
  }
  const update = ui.update.bind(ui)
  ui.update = (interval, face) => {
    counts.frames += 1
    update(interval, face)
  }
  class Driver extends NoneDriver {
    onAttached() {
      if (stage === 'motion') throw failure
    }
    onDetached() {
      counts.detached += 1
    }
    close() {
      counts.driver += 1
    }
  }
  class TouchDriver {
    sample() {
      return []
    }
    close() {
      counts.input += 1
    }
  }
  const touchPanel = new TouchPanel(TouchDriver)
  if (stage === 'input')
    touchPanel.start = () => {
      throw failure
    }
  const previous = () => {}
  const rawButton = { read: () => 1, onChanged: previous }
  let onDone: (() => void) | undefined
  const tts = {
    stream() {},
    close() {
      counts.tts += 1
    },
    get onDone() {
      return onDone
    },
    set onDone(value: (() => void) | undefined) {
      if (stage === 'audio' && value) throw failure
      onDone = value
    },
  }
  await rejectsSame(
    StackchanRuntimeContext.create({
      driver: new Driver(),
      ui,
      tts,
      touchPanel,
      button: { a: rawButton },
      speaker: {
        async tone() {},
        async play() {
          return true
        },
        async close() {
          await new Promise<void>((resolve) => Timer.set(() => resolve(), 1))
          counts.speaker += 1
        },
      },
      camera: {
        start() {},
        stop() {},
        async capture() {
          return undefined
        },
        close() {
          counts.camera += 1
        },
      },
      led: {
        face: {
          on() {},
          off() {},
          blink() {},
          rainbow() {},
          close() {
            counts.led += 1
          },
        },
      },
      connectivity: {
        get localPeer() {
          if (stage === 'capability') throw failure
          return undefined
        },
      },
      closeHandlers: [
        () => {
          counts.external += 1
        },
      ],
    }),
    failure,
  )
  for (const [name, count] of Object.entries(counts)) {
    if (name !== 'frames') equal(count, 1, `${stage}: ${name} is released exactly once before rejection`)
  }
  equal(rawButton.onChanged, previous, `${stage}: borrowed button is restored`)
  assert(application.first === null || application.first === undefined, `${stage}: Piu view is removed`)
  const frames = counts.frames
  await new Promise<void>((resolve) => Timer.set(() => resolve(), 60))
  equal(counts.frames, frames, `${stage}: no face timer survives initialization failure`)
}

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
  const context = await StackchanRuntimeContext.create({
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
  for (const stage of ['motion', 'audio', 'input', 'capability'] as const) await verifyRollback(stage)
  let uiFailed = false
  try {
    createAppControllerApplication({ main: new Container() })
  } catch {
    uiFailed = true
  }
  assert(uiFailed, 'invalid Piu main fails during construction')
  const replacement = createAppControllerApplication({ face: new SimpleFace() })
  assert(replacement.application.first, 'a new controller can take ownership after UI construction fails')
  replacement.close()
  const effectUI = createAppControllerApplication({ face: new SimpleFace() })
  const effectApplication = effectUI.application
  const effectContext = await StackchanRuntimeContext.create({
    driver: new NoneDriver(),
    ui: effectUI,
    tts: { stream() {} },
  })
  effectContext.showBalloon('cleanup')
  let removals = 0
  const removeFailure = new Error('effect removal failed')
  effectUI.removeEffect = () => {
    removals += 1
    throw removeFailure
  }
  await rejectsSame(effectContext.lifecycle.close(), removeFailure)
  effectContext.hideBalloon()
  equal(removals, 1, 'failed effect removal does not leave a retained balloon registration')
  assert(
    effectApplication.first === null || effectApplication.first === undefined,
    'effect removal failure still closes the Piu view',
  )
  const photoUI = createAppControllerApplication({ face: new SimpleFace() })
  const effects = new Set<unknown>()
  const addEffect = photoUI.addEffect.bind(photoUI)
  const removeEffect = photoUI.removeEffect.bind(photoUI)
  photoUI.addEffect = (effect) => {
    effects.add(effect)
    addEffect(effect)
  }
  photoUI.removeEffect = (effect) => {
    effects.delete(effect)
    removeEffect(effect)
  }
  let captures = 0,
    stops = 0,
    framesReleased = 0
  const photoContext = await StackchanRuntimeContext.create({
    driver: new NoneDriver(),
    ui: photoUI,
    tts: { stream() {} },
    camera: {
      available: true,
      availability: 'native',
      formats: ['rgb565le'],
      start() {},
      stop() {
        stops++
      },
      close() {},
      async capture() {
        captures++
        return {
          width: 2,
          height: 1,
          imageType: 'rgb565le',
          buffer: new Uint8Array([0, 248, 224, 7]).buffer,
          close() {
            framesReleased++
          },
        }
      },
    },
  })
  await photoContext.startApp(
    defineApp({
      async setup(app) {
        const image = await app.camera.capture()
        equal(captures, 1, 'public camera reaches the physical port')
        equal(framesReleased, 1, 'image is detached from native ownership')
        equal(stops, 1, 'capture finishes after stop')
        app.ui.showImage(image)
        equal(effects.size, 1, 'image is mounted on the actual Piu controller')
        app.ui.showImage(image)
        equal(effects.size, 1, 'replacing an image removes the previous one')
        app.ui.hideImage()
        equal(effects.size, 0, 'hide removes the image')
        app.ui.showImage(image)
      },
    }),
  )
  await photoContext.lifecycle.close()
  equal(effects.size, 0, 'app close removes its image before host close')
  trace('ok\n')
}

run().catch((error) => {
  trace(`context lifecycle failed: ${error}\n`)
  throw error
})
