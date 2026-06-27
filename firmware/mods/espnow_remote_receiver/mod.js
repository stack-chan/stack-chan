import { EspNowRemoteReceiver } from 'espnow-remote-receiver'

const ESP_NOW_REMOTE_OPTIONS = {
  channel: 1,
  receiverId: 1,
  interval: 30,
  ledName: 'head',
  laserBrightness: 24,
  defaultEnabled: true,
}

let _receiver
let _enabled = false

function startReceiver(robot) {
  if (_receiver) {
    return
  }
  void robot.setTorque(true)
  _receiver = new EspNowRemoteReceiver(robot, ESP_NOW_REMOTE_OPTIONS)
  _enabled = true
  robot.application.setDrawerButtonState('toggleEspNowRemote', true)
  trace('[espnow-remote-receiver] receiver started\n')
}

function stopReceiver(robot) {
  if (!_receiver) {
    return
  }
  _receiver.close()
  _receiver = undefined
  _enabled = false
  robot.lightOff(ESP_NOW_REMOTE_OPTIONS.ledName)
  void robot.setTorque(false)
  robot.application.setDrawerButtonState('toggleEspNowRemote', false)
  trace('[espnow-remote-receiver] receiver stopped\n')
}

function toggleReceiver(robot) {
  if (_enabled) {
    stopReceiver(robot)
  } else {
    startReceiver(robot)
  }
}

export function onRobotCreated(robot) {
  robot.application.addDrawerButton({
    key: 'toggleEspNowRemote',
    label: 'ESPNow',
    kind: 'toggle',
    initialState: false,
    callback: toggleReceiver,
  })

  if (ESP_NOW_REMOTE_OPTIONS.defaultEnabled) {
    startReceiver(robot)
  }
}

export default {
  onRobotCreated,
}
