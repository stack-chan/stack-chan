import { Server } from 'http'
import { ChatGPTDialogue } from 'dialogue-chatgpt'
import { randomBetween, asyncWait, loadPreferences } from 'stackchan-util'
import config from 'mc/config'
import { createBalloonDecorator, createBubbleDecorator } from 'decorator'


// const MODEL = 'gpt-4'
const MODEL = 'gpt-3.5-turbo'
const CONTEXT = [
  {
    role: 'system',
    content:
      'You are "スタックちゃん(Stack-chan)", the palm sized super kawaii companion robot baby. You must response in a short sentense.',
  },
  {
    role: 'assistant',
    content: 'ぼく、スタックちゃん！ねえ、お話しようよ！',
  },
]


// Integrate ChatGPT
const aiPrefs = loadPreferences('ai')
trace(`ai.token: ${aiPrefs.token}\n`)

const dialogue = new ChatGPTDialogue({
  apiKey: aiPrefs.token,
  model: MODEL,
  context: CONTEXT,
})

let chatting = false
async function chatAndSay(robot, message) {
  if (chatting) {
    return
  }
  chatting = true
  robot.showBalloon('Now thinking...')
  const result = await dialogue.post(message)
  if (!result.success) {
    trace(`failed: ${result.reason}`)
    return
  }

  //const messages = result.value.split(/[。！？]/).filter((m) => m.length > 0)
  //for (const message of messages) {
  //  trace(message)
  //  trace('\n')
  //  await robot.say(message)
  //}
  trace(result.value)
  trace('\n')
  robot.showBalloon('Speaking...')
  await robot.say(result.value)
  chatting = false
  robot.hideBalloon()
}


function getRequestParams(query){
  var params = {}
  query.split('&').forEach(function (item){
    var s = item.split('=')
    var k = decodeURIComponent(s[0])
    var v = decodeURIComponent(s[1])
    params[k] = v
    trace(`${k}:${params[k]}\n`)
  })

  return params
}

const bubble = createBubbleDecorator({
  x: 10,
  y: 20,
  width: 50,
  height: 60,
})

const EMOTIONS = ['NEUTRAL','HAPPY','SLEEPY','DOUBTFUL','SAD','ANGRY','COLD','HOT']

function aiStackchanApi(robot, path, params){
  var res = 'OK'

  if (path === '/speech') {
    if(params['voice']){
      trace(`voice:${params['voice']}\n`)
      robot.tts.speakerId = Number(params['voice'])
    }
    if(params['expression']){
      trace(`expression:${params['expression']}\n`)
      var idx = Number(params['expression'])
      //robot.setEmotion(EMOTIONS[idx])
    }
    if(params['say']){
      trace(`say:${params['say']}\n`)
      //await robot.say(params['say'])
      robot.say(params['say'])
    }
  }
  else if (path === '/chat') {
    if(params['voice']){
      trace(`voice:${params['voice']}\n`)
      robot.tts.speakerId = Number(params['voice'])
    }
    if(params['text']){
      trace(`text:${params['text']}\n`)
      //await chatAndSay(robot, params['text'])
      chatAndSay(robot, params['text'])
    }

  }
  else if (path === '/face') {
    trace(`face:${params['expression']}\n`)
    var idx = Number(params['expression'])
    robot.setEmotion(EMOTIONS[idx])
    if (EMOTIONS[idx] === 'SLEEPY') {
      robot.renderer.addDecorator(bubble)
    } else {
      robot.renderer.removeDecorator(bubble)
    }
  }
  else{
    res = 'Undefined'
  }

  return res
}

function onRobotCreated(robot) {
  robot.button.a.onChanged = async function () {
    if (this.read()) {
      robot.showBalloon('TTS test...')
      await robot.say('ttsテスト')
      robot.hideBalloon()
    }
  }
  robot.button.b.onChanged = async function () {
    if (this.read()) {
      await chatAndSay(robot, 'おはようございます')
    }
  }


  const server = new Server({ port: 80 })

  //server.callback = async function (message, value, value2) { //asyncだとresponseが失敗した
  server.callback = function (message, value, value2) {
    if (message === 2) {
      trace(value)
      trace('\n')
      this.path = value.split('?')[0]
      var query = value.split('?')[1]
      trace(this.path)
      trace('\n')
      trace(query)
      trace('\n')

      if(query){
        var params = getRequestParams(query)
        this.res = aiStackchanApi(robot, this.path, params)
      }
      
    }

    if (message === 4) {
      trace('message === 4\n')
      return String
    }
 
    if (message === 6) {
      trace('message === 6\n')
      trace(`value:${value}\n`)
      trace(`value2:${value2}\n`)

      var params = getRequestParams(value)
      this.res = aiStackchanApi(robot, this.path, params)
    }
 
    if (Server.prepareResponse === message) {
      const response = {
        headers: ['Content-type', 'text/plain'],
        body: this.res
      }
      return response
    }
  }

}

export default {
  onRobotCreated,
}
