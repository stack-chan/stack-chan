import Timer from 'timer'
import { randomBetween } from 'stackchan-util'
import { fetch, Headers } from 'fetch'
import WebSocket from 'WebSocket'
import API_KEY from 'api-key'

const headers = new Headers([
  ['Content-Type', 'application/json'],
  ['Authorization', `Bearer ${API_KEY}`],
])

const body = {
  model: 'gpt-3.5-turbo',
  messages: [
    {
      role: 'system',
      content: 'あなたはスーパーカワイイロボットのスタックチャンです。',
    },
    {
      role: 'system',
      content: 'ユーザからの問いかけに対して砕けた表現で完結に回答してください。',
    },
  ],
}

async function postChatMessage(message) {
  const b = {
    ...body,
    messages: [
      ...body.messages,
      {
        role: 'user',
        content: message,
      },
    ],
  }
  return fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', headers, body: JSON.stringify(b) })
    .then((response) => {
      trace(`\n${response.url} ${response.status} ${response.statusText}\n\n`)
      response.headers.forEach((value, key) => trace(`${key}: ${value}\n`))
      trace('\n')
      return response.json()
    })
    .then((response) => {
      return response.choices?.[0].message.content
    })
}

export function onRobotCreated(robot) {
  let chatting = false
  const chat = async function chat(message) {
    if (chatting) {
      return
    }
    chatting = true
    try {
      let res = await postChatMessage(message)
      trace(res + '\n')
      const messages = res.replaceAll('！', '。').split('。')
      for (const message of messages) {
        const result = await robot.say(message)
        if (!result.success) {
          trace('failed to say')
        }
      }
    } catch (e) {
      /* noop */
    } finally {
      chatting = false
    }
  }

  const ws = new WebSocket('ws://192.168.7.112:8080')
  ws.addEventListener('open', () => {
    trace('connected\n')
  })
  ws.addEventListener('message', (message) => {
    trace(`received: ${message.data}`)
    if (message.data != null && message.data.length > 1) {
      chat(message.data)
    }
  })
  ws.addEventListener('close', () => {
    trace('disconnected\n')
  })

  let isFollowing = false
  robot.button.a.onChanged = async function handleButtonAChanged() {
    if (this.read()) {
      trace(res)
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
