import { createAppControllerApplication } from 'app-controller'
import { DogFace, SimpleFace } from 'behaviors/face'
import defaultApp from 'default-app/main'
import IMU from 'imu'
import { NoneDriver } from 'none-driver'
import { STACKCHAN_DEMO_IMAGE_AVATAR_PACK as demo } from 'parts/image/image-avatar-pack'
import { StackchanRuntimeContext } from 'runtime-context'
import { defineApp } from 'stackchan'
import { ui as appUI } from 'stackchan/extensions/ui'
import type { ImageAvatarPack } from 'stackchan/image-avatar'
import { assert, equal } from 'testing/assert'
import Timer from 'timer'
import TouchPanel from 'touch-panel'

const wait = (ms: number) => new Promise<void>((resolve) => Timer.set(() => resolve(), ms))

export async function verifyDefaultApp(): Promise<void> {
  const ui = createAppControllerApplication({ face: new DogFace({}) })
  const application = ui.application
  const menus = new Map<string, { value?: string }>()
  const add = ui.addDrawerButton.bind(ui)
  const remove = ui.removeDrawerButton.bind(ui)
  ui.addDrawerButton = (button) => {
    menus.set(button.key, button)
    add(button)
  }
  ui.removeDrawerButton = (key) => {
    menus.delete(key)
    remove(key)
  }
  let imuSamples = 0,
    restorations = 0,
    captures = 0,
    stops = 0,
    released = 0
  const imu = new IMU(
    class {
      sample() {
        imuSamples++
        return {}
      }
    },
    { interval: 10 },
  )
  let touchSample = [0, 0, 0]
  const touch = new TouchPanel(
    class {
      sample() {
        return touchSample
      }
    },
    { interval: 10 },
  )
  const buttons = {
    a: { read: () => 1, onChanged() {} },
    b: { read: () => 1, onChanged() {} },
    c: { read: () => 1, onChanged() {} },
  }
  const host = await StackchanRuntimeContext.create({
    ui,
    driver: new NoneDriver(),
    button: buttons,
    imu,
    touchPanel: touch,
    restoreFace() {
      restorations++
      ui.setFace(new DogFace({}))
    },
    tts: {
      stream(_text, _volume, complete) {
        complete?.()
      },
    },
    camera: {
      available: true,
      formats: ['rgb565le'],
      start(request) {
        // QQVGA fits the shared camera/display DMA budget on CoreS3.
        assert(
          request && request.width <= 160 && request.height <= 120,
          'default preview uses the small native camera mode',
        )
      },
      async capture(request) {
        captures++
        return {
          width: request.width,
          height: request.height,
          imageType: 'rgb565le',
          buffer: new ArrayBuffer(request.width * request.height * 2),
          close() {
            released++
          },
        }
      },
      stop() {
        stops++
      },
      close() {},
    },
  })
  const session = await host.startApp(defaultApp)
  const view = appUI(session.context)
  equal(view.faceStyle, 'default', 'default app preserves the configured face at startup')
  const controller = ui as unknown as Record<string, (content: unknown, value?: string) => void>
  const choose = async (key: string, value?: string) => {
    const handler = controller[`sdk:menu:${key}`]
    assert(typeof handler === 'function', `default app registers ${key} through the host controller`)
    handler(undefined, value)
    await wait(40)
  }
  await choose('face', 'simple')
  equal(view.faceStyle, 'simple', 'SDK choice swaps the actual Piu face')
  await choose('hands', 'clap')
  await choose('emotion', 'happy')
  equal(menus.get('sdk:menu:emotion')?.value, 'happy')
  const lateMotion = imu.onEvent
  lateMotion?.({ kind: 'imu', motion: 'upsideDown', ticks: 0 })
  await wait(40)
  equal(menus.get('sdk:menu:emotion')?.value, 'sad', 'host converts sensor events into SDK reactions')
  await choose('emotion', 'neutral')
  for (const sample of [
    [10, 0, 0],
    [0, 0, 10],
    [0, 0, 0],
    [0, 0, 10],
    [10, 0, 0],
    [0, 0, 0],
  ]) {
    touchSample = sample
    await wait(30)
  }
  equal(menus.get('sdk:menu:emotion')?.value, 'happy', 'two opposite physical swipes trigger petting through the SDK')
  buttons.c.onChanged()
  await wait(40)
  equal(menus.get('sdk:menu:colors')?.value, 'dark', 'tertiary button and menu share the same value')
  await choose('camera')
  equal(captures, 1)
  equal(stops, 1, 'capture releases camera before the app displays the frame')
  equal(released, 1)
  const lateChoice = controller['sdk:menu:face']
  await session.close()
  equal(session.resourceCount, 0)
  equal(session.taskCount, 0)
  equal(menus.size, 0, 'app close removes every default menu')
  equal(restorations, 1, 'app close restores the host face selection')
  equal(imu.onEvent, undefined, 'last motion subscriber stops and unbinds IMU polling')
  const samples = imuSamples
  lateChoice(undefined, 'image')
  lateMotion?.({ kind: 'imu', motion: 'shake', ticks: 0 })
  await wait(60)
  equal(imuSamples, samples, 'app close leaves no sensor polling timer')
  equal(menus.size, 0, 'late callbacks cannot recreate closed app controls')
  await host.lifecycle.close()
  assert(!application.first, 'host still owns and closes the Piu root')
  // A host without sensors still supports the default UI and reports the omissions.
  const plain = await StackchanRuntimeContext.create({
    ui: createAppControllerApplication({ face: new SimpleFace({}) }),
    driver: new NoneDriver(),
    tts: { stream() {} },
  })
  const plainApp = await plain.startApp(defaultApp)
  for (const id of ['input.secondary', 'input.headTouch', 'input.motion', 'lighting'] as const)
    equal(plainApp.context.capabilities.get(id).availability, 'unavailable')
  await plain.lifecycle.close()
}

export async function verifyImageAvatar(): Promise<void> {
  const ui = createAppControllerApplication({ face: new DogFace({}) })
  const setFace = ui.setFace.bind(ui)
  let displayed: Parameters<typeof setFace>[0]
  let restorations = 0
  ui.setFace = (face) => {
    displayed = face
    setFace(face)
  }
  const host = await StackchanRuntimeContext.create({
    ui,
    driver: new NoneDriver(),
    tts: { stream() {} },
    restoreFace() {
      restorations++
      ui.setFace(new DogFace({}))
    },
  })
  const session = await host.startApp(defineApp({ setup() {} }))
  const view = appUI(session.context)
  view.setImageAvatar(demo)
  equal(view.faceStyle, 'avatar')
  const selected = displayed
  const missing = {
    ...demo,
    expressions: {
      ...demo.expressions,
      happy: { ...demo.expressions.happy, head: { ...demo.expressions.happy.head, texture: 'missing-avatar.png' } },
    },
  }
  for (const [pack, code] of [
    [undefined, 'INVALID_ARGUMENT'],
    [null, 'INVALID_ARGUMENT'],
    [missing, 'IO'],
  ] as const) {
    let failure: unknown
    try {
      view.setImageAvatar(pack as unknown as ImageAvatarPack)
    } catch (error) {
      failure = error
    }
    equal((failure as { code?: string })?.code, code, 'invalid data and missing future assets fail at selection')
    equal(displayed, selected, 'failed selection leaves the active Piu face intact')
    equal(view.faceStyle, 'avatar')
  }
  view.setFaceStyle('avatar')
  assert(displayed !== selected, 'built-in avatar also uses the renderer')
  await session.close()
  equal(restorations, 1, 'the app relinquishes custom appearance to the configured host face')
  assert(displayed !== selected, 'the configured host face replaces the app avatar')
  let failure: unknown
  try {
    view.setImageAvatar(demo)
  } catch (error) {
    failure = error
  }
  equal((failure as { code?: string })?.code, 'CLOSED', 'retained UI handles cannot reinstall a face')
  await host.lifecycle.close()
}
