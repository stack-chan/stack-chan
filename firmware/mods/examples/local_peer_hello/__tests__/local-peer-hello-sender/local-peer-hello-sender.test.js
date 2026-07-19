import { onContextCreated } from 'mod'
import { equal } from 'testing/assert'

async function settle() {
  for (let index = 0; index < 6; index += 1) await Promise.resolve()
}

async function runTest() {
  let openOptions
  let discoveryOptions
  let sendCall
  const balloons = []
  const receiver = { id: 'receiver-id', name: 'stackchan-receiver', secure: false }
  const session = {
    async discover(options) {
      discoveryOptions = options
      return [receiver]
    },
    async send(peerId, type, payload) {
      sendCall = { peerId, type, payload }
      return { messageId: 'message-id', peerId, attempts: 1 }
    },
  }
  const robot = {
    connectivity: {
      localPeer: {
        async open(options) {
          openOptions = options
          return session
        },
      },
    },
    ui: {
      showBalloon(text) {
        balloons.push(text)
      },
    },
  }

  onContextCreated(robot)
  await settle()

  equal(openOptions.displayName, 'stackchan-sender', 'sender manifest should start the sender role')
  equal(discoveryOptions.timeoutMs, 1000, 'sender should use bounded discovery')
  equal(sendCall.peerId, receiver.id, 'sender should target the discovered receiver')
  equal(sendCall.type, 'text', 'sender should use the text message type')
  equal(sendCall.payload.text, 'hello world 1', 'sender should include the incremental sequence')
  equal(balloons[1], '送信: hello world 1', 'sender should report the transmitted text')

  trace('ok\n')
}

runTest().catch((error) => {
  trace(`local-peer-hello sender test failed: ${String(error)}\n`)
  throw error
})
