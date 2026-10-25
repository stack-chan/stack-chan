import { getMuseSession } from 'stackchan-dock'

export default {
  onContextCreated(robot) {
    const muse = getMuseSession()
    if (!muse) {
      robot.ui.showBalloon('Muse optional host is required')
      return
    }
    const action = (callback) => () => {
      try {
        callback()
      } catch {
        robot.ui.showBalloon('Muse: configuration or connection required')
      }
    }
    robot.ui.drawer.addDrawerButton({ key: 'muse:connect', label: 'Muse接続', callback: action(() => muse.connect()) })
    robot.ui.drawer.addDrawerButton({
      key: 'muse:text',
      label: 'Museへ挨拶',
      callback: action(() => muse.sendText('こんにちは。短く返事をしてください。')),
    })
    robot.ui.drawer.addDrawerButton({ key: 'muse:stop', label: 'Muse停止', callback: action(() => muse.disconnect()) })
  },
}
