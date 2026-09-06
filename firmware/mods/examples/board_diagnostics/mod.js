import { defineApp } from 'stackchan'
import { StackchanError } from 'stackchan/errors'
import { input } from 'stackchan/extensions/input'
import { lighting } from 'stackchan/extensions/lighting'
import { ui } from 'stackchan/extensions/ui'

/** @param {unknown} error */
const message = (error) => (error instanceof Error ? error.message : String(error))

export default defineApp({
  setup(app) {
    const lights = lighting(app)
    const view = ui(app)
    const buttons = input(app)
    let name = lights.names.includes('head') ? 'head' : lights.names[0]
    let colorIndex = 0
    let busy = false
    const colors = [
      { r: 255, g: 0, b: 0 },
      { r: 0, g: 255, b: 0 },
      { r: 0, g: 0, b: 255 },
    ]
    const selected = () => {
      if (!name) throw new StackchanError('UNSUPPORTED', 'LED がありません。本体の設定と接続を確認してください。')
      return name
    }
    /** @param {import('stackchan/task').TaskHandler} action */
    const guarded = (action) => async (/** @type {import('stackchan/task').TaskContext} */ task) => {
      if (busy) return
      busy = true
      try {
        await action(task)
      } catch (error) {
        if (!task.signal.reason) view.showBalloon(message(error))
      } finally {
        busy = false
      }
    }
    if (name)
      view.addChoice(
        {
          id: 'led',
          label: 'LED',
          value: name,
          options: lights.names.map((value) => ({ value, label: value })),
        },
        (next) => {
          if (busy) throw new StackchanError('BUSY', '診断中は LED を切り替えられません。')
          lights.off(selected())
          name = next
        },
      )
    const color = guarded(() => {
      lights.color(selected(), colors[colorIndex])
      colorIndex = (colorIndex + 1) % colors.length
    })
    const off = guarded(() => lights.off(selected()))
    const rainbow = guarded(() => lights.rainbow(selected()))
    const blink = guarded(() => lights.blink(selected(), { r: 0, g: 24, b: 0 }, { periodMs: 250 }))
    for (const [id, label, action] of /** @type {[string, string, import('stackchan/task').TaskHandler][]} */ ([
      ['color', 'LED 色', color],
      ['off', 'LED 消灯', off],
      ['rainbow', 'LED 虹', rainbow],
      ['blink', 'LED 点滅', blink],
    ]))
      view.addAction({ id, label }, action)
    buttons.onPress('primary', color)
    if (app.capabilities.get('input.secondary').availability !== 'unavailable') buttons.onPress('secondary', off)
    if (app.capabilities.get('input.tertiary').availability !== 'unavailable') buttons.onPress('tertiary', rainbow)

    const check = guarded(async (task) => {
      trace('[board diagnostics] start\n')
      view.showBalloon('サーボと LED を確認します。')
      const failures = []
      const info = app.motion.info
      try {
        if (info.availability === 'unavailable') throw new StackchanError('UNSUPPORTED', info.reason)
        try {
          for (const [yawDeg, pitchDeg] of [
            [0, 0],
            [4.58, -3.44],
            [0, 0],
          ]) {
            await app.motion.move(
              {
                yawDeg: Math.max(info.yawDeg[0], Math.min(info.yawDeg[1], yawDeg)),
                pitchDeg: Math.max(info.pitchDeg[0], Math.min(info.pitchDeg[1], pitchDeg)),
              },
              { durationMs: 500, signal: task.signal },
            )
            await task.sleep(1200)
          }
        } finally {
          if (!task.signal.reason) {
            if (info.canRelax) await app.motion.relax()
            else await app.motion.stop()
          }
        }
        trace(`[board diagnostics] servo: ${info.availability}\n`)
      } catch (error) {
        task.signal.throwIfCancelled()
        failures.push(`servo: ${message(error)}`)
      }
      try {
        const led = selected()
        try {
          lights.color(led, { r: 24, g: 0, b: 0 })
          await task.sleep(1200)
          lights.blink(led, { r: 0, g: 24, b: 0 }, { periodMs: 250 })
          await task.sleep(2400)
          lights.rainbow(led)
          await task.sleep(2400)
        } finally {
          if (!task.signal.reason) lights.off(led)
        }
        trace(`[board diagnostics] LED: ${led}\n`)
      } catch (error) {
        task.signal.throwIfCancelled()
        failures.push(`LED: ${message(error)}`)
      }
      if (failures.length) {
        trace(`[board diagnostics] error: ${failures.join('; ')}\n`)
        view.showBalloon(failures.join('\n'))
      } else {
        trace(`[board diagnostics] ${info.availability === 'native' ? 'complete' : 'simulated'}\n`)
        view.showBalloon('診断が終了しました。動きと光を確認してください。')
      }
    })
    view.addAction({ id: 'check', label: 'ボード診断' }, check)
    app.time.after(1000, check)
  },
})
