import { onContextCreated } from 'mod'
import { equal } from 'testing/assert'

async function settle() {
  for (let index = 0; index < 6; index += 1) await Promise.resolve()
}

async function runTest() {
  let openOptions
  let discoveryOptions
  let sendCall
  let drawerButton
  let closeCount = 0
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
    close() {
      closeCount += 1
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
      drawer: {
        addDrawerButton(button) {
          drawerButton = button
        },
      },
      showBalloon(text) {
        balloons.push(text)
      },
    },
  }

  onContextCreated(robot)
  await settle()

  equal(openOptions, undefined, 'local peer should remain stopped until a role is selected')
  await drawerButton.callback(robot, 'sender')
  await settle()

  equal(openOptions.displayName, 'stackchan-sender', 'sender selection should open the sender role')
  equal(discoveryOptions.timeoutMs, 1000, 'sender should use bounded discovery')
  equal(sendCall.peerId, receiver.id, 'sender should target the discovered receiver')
  equal(sendCall.type, 'text', 'sender should use the text message type')
  equal(sendCall.payload.text, 'hello world 1', 'sender should include the incremental sequence')
  equal(balloons[3], '送信: hello world 1', 'sender should report the transmitted text')

  await drawerButton.callback(robot, 'stopped')
  equal(closeCount, 1, 'stopped selection should close the sender session')
  equal(balloons[4], 'P2P: 停止', 'stopped selection should report the stopped state')

  trace('ok\n')
}

runTest().catch((error) => {
  trace(`local-peer-hello sender test failed: ${String(error)}\n`)
  throw error
})
