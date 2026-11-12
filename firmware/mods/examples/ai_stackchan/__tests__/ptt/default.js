export const state = { calls: 0, handler() {} }
export default {
  onContextCreated(robot) {
    state.calls++
    robot.ui.drawer.addDrawerButton({ key: 'settings' })
    if (robot.input.button?.a) robot.input.button.a.onEvent = state.handler
  },
}
