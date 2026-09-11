import type { AppContext, CapabilityId } from 'stackchan/app'
import { StackchanError } from 'stackchan/errors'
import { input } from 'stackchan/extensions/input'
import { lighting } from 'stackchan/extensions/lighting'
import { ui } from 'stackchan/extensions/ui'
import type { TaskHandler, Unsubscribe } from 'stackchan/task'
import type { installCompanion } from './companion'

export function installDiagnostics(app: AppContext, companion: ReturnType<typeof installCompanion>) {
  const view = ui(app)
  let busy = false
  let hideFeedback: Unsubscribe | undefined
  const action = (id: string, label: string, capabilities: readonly CapabilityId[], run: TaskHandler) => {
    const handler: TaskHandler = async (task) => {
      if (busy) {
        view.showBalloon('BUSY: wait for the current test')
        return
      }
      busy = true
      hideFeedback?.()
      view.closeMenu()
      try {
        for (const id of capabilities) {
          const status = app.capabilities.get(id)
          if (status.availability === 'unavailable') throw new StackchanError('UNSUPPORTED', status.reason)
        }
        await run(task)
      } catch (error) {
        if (!task.signal.reason)
          view.showBalloon(error instanceof StackchanError ? `${error.code}: ${error.message}` : 'IO: operation failed')
        throw error
      } finally {
        busy = false
        if (!task.signal.reason) hideFeedback = app.time.after(1500, () => view.hideBalloon())
      }
    }
    view.addAction({ id, label }, handler)
    return handler
  }
  action('speak', 'Speak', ['audio.speech'], async ({ signal }) => {
    await app.audio.say('こんにちわ。すたっくちゃんです。', { signal })
  })
  action('camera', view.localize('drawer.camera'), ['camera'], async (task) => {
    view.showBalloon('starting camera...')
    const image = await app.camera.capture({ width: 160, height: 120, signal: task.signal })
    view.hideBalloon()
    view.showImage(image)
    await task.sleep(5000)
    view.hideImage()
  })
  const servo = action('servo', view.localize('drawer.servo'), ['motion'], async (task) => {
    await companion.stop()
    view.showBalloon('moving...')
    try {
      for (const [yawDeg, pitchDeg] of [
        [30, 0],
        [-30, 0],
        [0, 5.625],
        [0, -10],
        [0, 0],
      ]) {
        await companion.move({ yawDeg, pitchDeg }, task)
        await task.sleep(1000)
      }
    } finally {
      if (!task.signal.reason) await companion.relax()
    }
    view.hideBalloon()
  })
  if (app.capabilities.get('input.secondary').availability !== 'unavailable') input(app).onPress('secondary', servo)
  action('tone', view.localize('drawer.playSound'), ['audio.tone'], async ({ signal }) => {
    view.showBalloon('playing tone...')
    await app.audio.tone(880, { durationMs: 400, volume: 0.35, signal })
    view.showBalloon('tone complete')
  })
  action('record', view.localize('drawer.recordAndPlay'), ['audio.recording', 'audio.playback'], async ({ signal }) => {
    view.showBalloon('recording...')
    const recording = await app.audio.record({ durationMs: 2000, signal })
    view.showBalloon('playing...')
    await app.audio.play(recording, { signal })
    view.showBalloon('playback complete')
  })
  const lights = lighting(app)
  const name = lights.names[0]
  if (name)
    view.addToggle({ id: 'led', label: 'LED', value: false }, (enabled) => {
      if (enabled) lights.rainbow(name)
      else lights.off(name)
    })
}
