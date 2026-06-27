import { EspNowRemoteSender } from 'espnow-remote-sender'

const ESP_NOW_REMOTE_SENDER_OPTIONS = {
  channel: 1,
  targetId: 0,
  interval: 50,
  speed: 600,
  laserEnabled: false,
  defaultEnabled: true,
}

let _sender
let _enabled = false

function startSender(robot) {
  if (_sender) {
    return
  }
  _sender = new EspNowRemoteSender(robot, ESP_NOW_REMOTE_SENDER_OPTIONS)
  _enabled = true
  robot.application.setDrawerButtonState('toggleEspNowSender', true)
  trace('[espnow-remote-sender] sender started\n')
}

function stopSender(robot) {
  if (!_sender) {
    return
  }
  _sender.close()
  _sender = undefined
  _enabled = false
  robot.application.setDrawerButtonState('toggleEspNowSender', false)
  trace('[espnow-remote-sender] sender stopped\n')
}

function toggleSender(robot) {
  if (_enabled) {
    stopSender(robot)
  } else {
    startSender(robot)
  }
}

export function onRobotCreated(robot) {
  robot.application.addDrawerButton({
    key: 'toggleEspNowSender',
    label: 'ESPSend',
    kind: 'toggle',
    initialState: false,
    callback: toggleSender,
  })

  if (ESP_NOW_REMOTE_SENDER_OPTIONS.defaultEnabled) {
    startSender(robot)
  }
}

export default {
  onRobotCreated,
}
