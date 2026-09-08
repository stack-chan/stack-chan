import { createAppControllerApplication } from 'app-controller'
import { SimpleFace } from 'behaviors/face'
import type { MiniAppRegistry } from 'mini-app'
import Modules from 'modules'
import { directMotionPort, motionInfo } from 'motion-port'
import { NoneDriver } from 'none-driver'
import { Container } from 'piu/MC'
import { StackchanRuntimeContext } from 'runtime-context'
import { defineApp, StackchanError } from 'stackchan'
import { definePiuApp, Port, type ScreenContext, type ViewPort } from 'stackchan/extensions/piu'
import { CAPABILITY_IDS } from 'stackchan-contracts/capabilities'
import { assert, equal } from 'testing/assert'
import { verifyDefaultApp, verifyGeneratedAppPorts, verifyImageAvatar } from 'tests/default-app'
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
    readonly motion = directMotionPort(this, motionInfo('estimated', [-90, 90], [-30, 30]))
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
      get connectivity() {
        if (stage === 'capability') throw failure
        return {}
      },
      closeHandlers: [
        () => {
          counts.external += 1
        },
      ],
    }).then(async (host) => {
      try {
        await host.startApp(defineApp({ setup() {} }))
      } catch (error) {
        try {
          await host.close()
        } catch {
          /* Preserve the setup failure. */
        }
        throw error
      }
    }),
    failure,
  )
  for (const [name, count] of Object.entries(counts)) {
    if (name !== 'frames')
      equal(
        count,
        name === 'detached' && stage !== 'motion' ? 0 : 1,
        `${stage}: ${name} is released exactly once if acquired`,
      )
  }
  equal(rawButton.onChanged, previous, `${stage}: borrowed button is restored`)
  assert(application.first === null || application.first === undefined, `${stage}: Piu view is removed`)
  const frames = counts.frames
  await new Promise<void>((resolve) => Timer.set(() => resolve(), 60))
  equal(counts.frames, frames, `${stage}: no face timer survives initialization failure`)
}

async function verifyPiuApp(mode: 'normal' | 'setup' | 'dispose' | 'undisplay' | 'view'): Promise<void> {
  const ui = createAppControllerApplication({ face: new SimpleFace() })
  const application = ui.application
  const registry = ui.miniApps as MiniAppRegistry
  let attachments = 0
  const driver = new (class extends NoneDriver {
    onAttached() {
      attachments++
    }
  })()
  const host = await StackchanRuntimeContext.create({ driver, ui, tts: { stream() {} } })
  equal(host.getCapability('motion').availability, 'unavailable', 'preflight observes a driver without a motion port')
  equal(host.getCapability('ui.piu').availability, 'native', 'preflight observes the real Piu host')
  for (const id of CAPABILITY_IDS)
    assert(host.getCapability(id).availability, 'every public capability has a runtime decision')
  equal(attachments, 0, 'capability discovery does not attach or start app motion')
  if (mode === 'normal') {
    assert(Modules.has('app-http'), 'fixture includes the HTTP client module')
    const platform = globalThis as unknown as { device: Record<string, unknown> }
    const device = platform.device
    try {
      platform.device = { ...device, network: {} }
      equal(
        host.getCapability('network.http').availability,
        'unavailable',
        'a bundled HTTP module needs a live client port',
      )
      equal(host.getCapability('conversation.dialogue').availability, 'unavailable', 'cloud dialogue needs HTTPS')
    } finally {
      platform.device = device
    }
  }
  const failure = new StackchanError('IO', `screen ${mode} failed`)
  let screenContext: ScreenContext | undefined
  let frames = 0
  let disposals = 0
  const starting = host.startApp(
    definePiuApp({
      screens: [
        {
          id: 'owned-screen',
          title: 'Owned screen',
          create(context) {
            screenContext = context
            const ownedPort = new Port(null, {
              left: 0,
              right: 0,
              top: 0,
              bottom: 0,
              Behavior: class extends Behavior {
                onDisplaying(content: ViewPort) {
                  content.interval = 10
                  content.start()
                }
                onTimeChanged() {
                  frames += 1
                }
                onUndisplaying(content: ViewPort) {
                  if (mode === 'undisplay') throw failure
                  content.stop()
                }
              },
            })
            return {
              content: new Container(null, { left: 0, right: 0, top: 0, bottom: 0, contents: [ownedPort] }),
              dispose() {
                disposals += 1
                ownedPort.stop()
                if (mode === 'dispose') throw failure
              },
            }
          },
        },
      ],
      setup() {
        if (mode === 'setup') throw failure
      },
    }),
  )
  if (mode === 'setup') {
    await rejectsSame(starting, failure)
    equal(registry.list().length, 0, 'failed setup rolls back screen registration')
    await host.close()
    return
  }
  const app = await starting
  equal(attachments, 0, 'a driver without motion stays unattached after setup')
  equal(app.context.capabilities.get('motion').availability, 'unavailable', 'SDK and boot agree on missing motion')
  assert(ui.launchMiniApp('owned-screen'), 'SDK screen launches in the host Piu viewport')
  assert(screenContext, 'screen receives its SDK context')
  equal(screenContext.app, app.context, 'screen uses the same AppSession as setup')
  equal(screenContext.height, 196, 'host reserves the AppBar above the viewport')
  equal(app.context.capabilities.get('ui.piu').availability, 'native', 'host advertises its screen capability')
  // Parallel native builds can delay GTK's first display beyond two seconds.
  // Wait for the actual frame, within the runner's 30-second runtime deadline.
  for (let attempt = 0; frames === 0 && attempt < 500; attempt++)
    await new Promise<void>((resolve) => Timer.set(() => resolve(), 20))
  assert(frames > 0, `actual Piu Port timer runs while screen is displayed (${mode})`)
  if (mode === 'normal') {
    screenContext.close()
    equal(disposals, 1, 'screen Back releases its instance')
    assert(ui.launchMiniApp('owned-screen'), 'closed screen can be recreated within the app')
  }
  if (mode === 'view') {
    const view = application.first as Container
    const behavior = view.behavior as { showFace(): void }
    const showFace = behavior.showFace.bind(behavior)
    behavior.showFace = () => {
      showFace()
      throw failure
    }
  }
  const fails = mode === 'dispose' || mode === 'view'
  const closing = app.close()
  if (fails) await rejectsSame(closing, failure)
  else await closing
  equal(registry.list().length, 0, 'app close unregisters its screens')
  equal(disposals, mode === 'normal' ? 2 : 1, 'app close releases each created screen exactly once')
  const stoppedFrames = frames
  await new Promise<void>((resolve) => Timer.set(() => resolve(), 60))
  equal(frames, stoppedFrames, 'Piu frames stop even when undisplaying or disposal throws')
  assert(!ui.launchMiniApp('owned-screen'), 'closed app cannot be launched again')
  if (fails) await rejectsSame(host.close(), failure)
  else await host.close()
  assert(!application.first, 'host cleanup removes its Piu tree after screen failure')
}

async function run() {
  let previousCalls = 0
  let presses = 0
  let tones = 0
  let cancellations = 0
  let finishTone: (() => void) | undefined
  let finishCancellation: (() => void) | undefined
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
        return new Promise<void>((resolve) => {
          finishCancellation = () => {
            finishTone?.()
            resolve()
          }
        })
      },
    },
    button: { a: rawButton },
  })
  // These entrypoints were retired, including their emitted XS properties.
  for (const name of [
    'useTTS',
    'button',
    'touch',
    'touchPanel',
    'imu',
    'pose',
    'microphone',
    'say',
    'sing',
    'record',
    'tone',
    'playAudio',
    'lookAt',
    'showBalloon',
    'hideBalloon',
    'lookAway',
    'setPose',
    'setTorque',
    'setColor',
    'setEmotion',
    'setEyeOpen',
    'setMouthOpen',
    'tts',
    'drawer',
    'led',
    'lightOn',
    'lightOff',
    'lightBlink',
    'lightRainbow',
  ])
    assert(!(name in context), `flat context entrypoint remains: ${name}`)
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
  const close = context.close()
  equal(close, context.close(), 'host close shares its completion')
  let closed = false
  void close.then(() => {
    closed = true
  })
  await new Promise<void>((resolve) => Timer.set(() => resolve(), 1))
  equal(closed, false, 'host waits for app audio release after task cancellation')
  equal(cancellations, 1, 'app close reaches active speaker before host device cleanup')
  finishCancellation?.()
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
  await effectContext.startApp(
    defineApp({
      setup(app) {
        app.ui.showBalloon('cleanup')
      },
    }),
  )
  let removals = 0
  const removeFailure = new Error('effect removal failed')
  effectUI.removeEffect = () => {
    removals += 1
    throw removeFailure
  }
  await rejectsSame(effectContext.close(), removeFailure)
  await rejectsSame(effectContext.close(), removeFailure)
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
  await photoContext.close()
  equal(effects.size, 0, 'app close removes its image before host close')
  for (const mode of ['normal', 'setup', 'dispose', 'undisplay', 'view'] as const) await verifyPiuApp(mode)
  await verifyDefaultApp()
  await verifyImageAvatar()
  await verifyGeneratedAppPorts()
  trace('ok\n')
}

run().catch((error) => {
  trace(`context lifecycle failed: ${error}\n`)
  throw error
})
