import { onContextCreated } from 'mod'
import { equal } from 'testing/assert'

async function settle() {
  for (let index = 0; index < 6; index += 1) await Promise.resolve()
}

async function runTest() {
  let openOptions
  let subscribedType
  let messageHandler
  const balloons = []
  const session = {
    subscribe(type, handler) {
      subscribedType = type
      messageHandler = handler
      return () => undefined
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

  equal(openOptions.displayName, 'stackchan-receiver', 'default manifest should start the receiver role')
  equal(subscribedType, 'text', 'receiver should subscribe to text messages')
  equal(balloons[0], '受信機: メッセージを待っています', 'receiver should display its ready state')

  messageHandler({
    peer: { id: 'peer-id', name: 'stackchan-sender', secure: false },
    payload: { text: 'hello\nworld 7\u202e' },
  })
  equal(balloons[1], 'hello world 7', 'receiver should display sanitized message text')

  messageHandler({
    peer: { id: 'peer-id', name: 'stackchan-sender', secure: false },
    payload: { text: 8 },
  })
  equal(balloons.length, 2, 'receiver should ignore invalid payload text')

  trace('ok\n')
}

runTest().catch((error) => {
  trace(`local-peer-hello receiver test failed: ${String(error)}\n`)
  throw error
})
