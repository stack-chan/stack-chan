import type { AppContext } from 'stackchan/app'
import { input } from 'stackchan/extensions/input'
import { ui } from 'stackchan/extensions/ui'
import type { MotionTarget } from 'stackchan/motion'
import type { TaskContext, Unsubscribe } from 'stackchan/task'
import type { installAppearance } from './appearance.js'

const random = (minimum: number, maximum: number) => minimum + Math.random() * (maximum - minimum)

export function installCompanion(app: AppContext, appearance: ReturnType<typeof installAppearance>) {
  const view = ui(app)
  const inputs = input(app)
  let following = false
  // Remember this app's requested posture; drivers retain measured/estimated position internally.
  let posture: MotionTarget = { yawDeg: 0, pitchDeg: 0 }
  let cancelPet: Unsubscribe | undefined
  let cancelRestore: Unsubscribe | undefined
  let petOrigin: MotionTarget | undefined
  const info = app.motion.info
  const clamp = (target: MotionTarget): MotionTarget =>
    info.availability === 'unavailable'
      ? target
      : {
          yawDeg: Math.max(info.yawDeg[0], Math.min(info.yawDeg[1], target.yawDeg)),
          pitchDeg: Math.max(info.pitchDeg[0], Math.min(info.pitchDeg[1], target.pitchDeg)),
        }
  const relax = () => (info.availability !== 'unavailable' && info.canRelax ? app.motion.relax() : app.motion.stop())
  const move = async (target: MotionTarget, task: TaskContext, durationMs = 300) => {
    const next = clamp(target)
    await app.motion.move(next, { durationMs, signal: task.signal })
    posture = next
  }
  const look = () => {
    const x = random(0.4, 1)
    const y = random(-0.4, 0.4)
    const z = random(-0.02, 0.2)
    posture = clamp({
      yawDeg: (Math.atan2(y, x) * 180) / Math.PI,
      pitchDeg: (-Math.atan2(z, Math.hypot(x, y)) * 180) / Math.PI,
    })
    app.motion.lookAt(posture)
  }
  const setFollowing = async (enabled: boolean) => {
    cancelPet?.()
    cancelRestore?.()
    petOrigin = undefined
    if (info.availability !== 'unavailable') await relax()
    if (enabled) look()
    following = enabled
    followControl?.setValue(enabled)
  }
  const followControl =
    info.availability === 'unavailable'
      ? undefined
      : view.addToggle(
          {
            id: 'look',
            label: view.localize('drawer.lookAround'),
            value: false,
          },
          setFollowing,
        )
  if (followControl) {
    inputs.onPress('primary', () => setFollowing(!following))
    app.time.every(5000, () => {
      if (following && !petOrigin) look()
    })
  }
  if (app.capabilities.get('input.motion').availability !== 'unavailable')
    inputs.onMotion(({ motion }) =>
      appearance.react(motion === 'shake' ? 'hot' : motion === 'upsideDown' ? 'sad' : 'angry', 5000),
    )
  if (app.capabilities.get('input.headTouch').availability !== 'unavailable') {
    let previousSwipe: 'forwardSwipe' | 'backwardSwipe' | undefined
    let cancelWindow: Unsubscribe | undefined
    inputs.onHeadTouch(({ gesture }) => {
      if (gesture !== 'forwardSwipe' && gesture !== 'backwardSwipe') return
      cancelWindow?.()
      const paired = previousSwipe !== undefined && previousSwipe !== gesture
      previousSwipe = paired ? undefined : gesture
      if (!paired) {
        cancelWindow = app.time.after(1500, () => {
          previousSwipe = undefined
        })
        return
      }
      appearance.react('happy', 5000)
      if (info.availability === 'unavailable') return
      const restore = petOrigin ?? { ...posture }
      petOrigin = restore
      cancelPet?.()
      cancelRestore?.()
      cancelPet = app.time.after(0, async (task) => {
        try {
          app.motion.lookAway()
          const yaw = random(12, 18) * (Math.random() < 0.5 ? -1 : 1)
          const up = { ...restore, pitchDeg: Math.max(-45, restore.pitchDeg - random(18, 22.5)) }
          for (const direction of [1, -1, 0.55, 0])
            await move({ ...up, yawDeg: Math.max(-30, Math.min(30, restore.yawDeg + yaw * direction)) }, task, 220)
        } catch (error) {
          if (!task.signal.reason) {
            cancelRestore?.()
            petOrigin = undefined
            view.showBalloon('motion error')
            app.time.after(1500, () => view.hideBalloon())
            await relax()
          }
          throw error
        }
      })
      cancelRestore = app.time.after(5000, async (task) => {
        cancelPet?.()
        petOrigin = undefined
        if (following) {
          posture = restore
          app.motion.lookAt(restore)
        } else {
          await move(restore, task, 220)
          await relax()
        }
      })
    })
  }
  return { move, stop: () => setFollowing(false), relax }
}
