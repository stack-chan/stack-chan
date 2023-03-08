import Timer from 'timer'
import { randomBetween } from 'stackchan-util'
import WebSocket from 'WebSocket'
import API_KEY from 'api-key'

export function onRobotCreated(robot) {
  const ws = new WebSocket('ws://192.168.7.112:8080')
  const dialogue = new ChatGPTDialogue({
    apiKey: API_KEY,
  })
  ws.addEventListener('open', () => {
    trace('connected\n')
  })
  ws.addEventListener('message', (message) => {
    trace(`received: ${message.data}`)
    if (message.data != null && message.data.length > 1) {
      dialogue.postMessage(message.data)
    }
  })
  ws.addEventListener('close', () => {
    trace('disconnected\n')
  })

  let isFollowing = false
  robot.button.a.onChanged = async function handleButtonAChanged() {
    if (this.read()) {
      isFollowing = !isFollowing
    }
  }
  robot.button.b.onChanged = async function handleButtonBChanged() {
    if (this.read()) {
      trace('pressed B\n')
    }
  }
  robot.button.c.onChanged = async function handleButtonCChanged() {
    if (this.read()) {
      trace('pressed C\n')
      await robot.say('あのー、スタックチャンはちょっとそれよくわかんないんです。')
      await robot.say('太陽の光が大気に散乱されるから青っぽく見えるんだとか。')
      await robot.say('分かりにくい説明でごめんなさい。')
    }
  }
  const targetLoop = () => {
    if (!isFollowing) {
      robot.lookAway()
      return
    }
    const x = randomBetween(0.4, 1.0)
    const y = randomBetween(-0.4, 0.4)
    const z = randomBetween(-0.02, 0.2)
    trace(`looking at: [${x}, ${y}, ${z}]\n`)
    robot.lookAt([x, y, z])
  }
  Timer.repeat(targetLoop, 5000)
}
