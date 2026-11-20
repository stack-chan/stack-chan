/** Reuse the host motion API; no timer or torque request exists before the first explicit toggle. */
export function installLookAround(context, Timer, randomBetween) {
  const key = 'media:look-around'
  let enabled = false,
    closed = false,
    timer,
    pending
  const update = () => context.drawer.setDrawerButtonState(key, enabled)
  const stop = () => {
    enabled = false
    if (timer !== undefined) Timer.clear(timer)
    timer = undefined
    context.motion.lookAway()
    update()
  }
  const look = () => {
    if (enabled && !closed)
      context.motion.lookAt([randomBetween(0.4, 1.0), randomBetween(-0.4, 0.4), randomBetween(-0.02, 0.2)])
  }
  const toggle = async () => {
    const next = !enabled
    if (!next) stop()
    try {
      await context.motion.setTorque(next)
      if (next && !closed) {
        enabled = true
        look()
        timer = Timer.repeat(look, 5000)
        update()
      }
    } catch (error) {
      stop()
      if (next) await context.motion.setTorque(false).catch(() => {})
      throw error
    }
  }
  context.drawer.addDrawerButton({
    key,
    label: context.i18n.localize('drawer.lookAround'),
    kind: 'toggle',
    initialState: false,
    callback() {
      if (closed || pending) return pending
      pending = toggle().finally(() => {
        pending = undefined
      })
      return pending
    },
  })
  return async () => {
    closed = true
    stop()
    await pending?.catch(() => {})
    await context.motion.setTorque(false)
  }
}
