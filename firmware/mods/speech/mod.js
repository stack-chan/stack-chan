import Timer from 'timer'
import { randomBetween } from 'stackchan-util'
import WebSocket from 'WebSocket'
import API_KEY from 'api-key'
import { ChatGPTDialogue } from 'dialogue-chatgpt'

let chatting = false
const chat = async function chat(message) {
  if (chatting) {
    return
  }
  chatting = true
  try {
    let res = await postChatMessage(message)
    trace(res + '\n')
    const messages = res
      .replaceAll('！', '。')
      .split('。')
      .filter((msg) => msg.length > 0)
    for (const message of messages) {
      const result = await robot.say(message)
      if (!result.success) {
        trace('failed to say')
      }
    }
  } catch (e) {
    // noop
  } finally {
    chatting = false
  }
}
export function onRobotCreated(robot) {
  const dialogue = new ChatGPTDialogue({
    apiKey: API_KEY,
  })

  let chatting = false
  async function chatAndSay(message){
    if (chatting) {
      return
    }
    chatting = true
    const result = await dialogue.post(message)
    if (!result.success) {
      trace(`failed: ${result.reason}`)
    }

    const messages = result.value.split(/[。！？]/).filter(m => m.length > 0)
    for (const message of messages) {
      await robot.say(message)
    }
    chatting = false
  }
  const ws = new WebSocket('ws://192.168.7.112:8080')
  ws.addEventListener('open', () => {
    trace('connected\n')
  })
  ws.addEventListener('message', (message) => {
    trace(`received: ${message.data}`)
    if (message.data != null && message.data.length > 1) {
      chatAndSay(message.data)
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
      await chatAndSay('おはようございます')
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
