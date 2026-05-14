export default {
  onLaunch() {
    trace('[sample-mod] onLaunch from browser simulator sample\n')
    return true
  },
  async onRobotCreated(robot) {
    trace('[sample-mod] onRobotCreated from browser simulator sample\n')
    robot.setColor?.('primary', 0x30, 0xe0, 0xff)
    robot.setColor?.('secondary', 0xff, 0x70, 0xd8)
    await robot.showBalloon?.('sample .xsa OK', { timeout: 1500 })
  },
}
