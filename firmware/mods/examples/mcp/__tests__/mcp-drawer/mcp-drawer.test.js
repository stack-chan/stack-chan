import definition from 'mod'
import { equal } from 'testing/assert'

let options, showEndpoint, speech, emotion
const balloons = []
const app = {
  network: {
    async ready() {},
    address() {
      return '192.0.2.1'
    },
    serveTools(value) {
      options = value
      return { close() {} }
    },
  },
  audio: {
    async say(text) {
      speech = text
    },
  },
  face: {
    setEmotion(value) {
      emotion = value
    },
  },
  ui: {
    addAction(_options, handler) {
      showEndpoint = handler
    },
    showBalloon(text) {
      balloons.push(text)
    },
  },
}
await definition.setup(app)
equal(options.port, 8080, 'MCP keeps its listener port')
showEndpoint()
equal(balloons.at(-1), 'http://192.0.2.1:8080/mcp', 'endpoint uses the connected interface address')
const speak = options.tools.find((tool) => tool.name === 'say_message')
await speak.execute({ message: 'hello' }, {})
equal(speech, 'hello', 'MCP calls await SDK speech completion')
const face = options.tools.find((tool) => tool.name === 'set_emotion')
await face.execute({ emotion: 'HAPPY' }, {})
equal(emotion, 'happy', 'legacy wire emotion is translated into the public SDK name')
await face.execute({ emotion: 'INVALID' }, {})
equal(emotion, 'happy', 'invalid emotion does not change the face')
trace('ok\n')
