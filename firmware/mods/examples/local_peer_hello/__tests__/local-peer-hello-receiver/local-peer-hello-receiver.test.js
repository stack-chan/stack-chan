import { onContextCreated } from 'mod'
import { equal } from 'testing/assert'

async function settle() {
  for (let index = 0; index < 6; index += 1) await Promise.resolve()
}

async function runTest() {
  let openOptions
  let subscribedType
  let messageHandler
  let drawerButton
  let unsubscribeCount = 0
  let closeCount = 0
  const balloons = []
  const session = {
    subscribe(type, handler) {
      subscribedType = type
      messageHandler = handler
      return () => {
        unsubscribeCount += 1
      }
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
  equal(drawerButton.label, 'P2P', 'drawer should expose the P2P role selection')
  equal(drawerButton.kind, 'choice', 'P2P drawer item should be a selection')
  equal(drawerButton.value, 'stopped', 'P2P selection should default to stopped')
  equal(drawerButton.options[0].value, 'stopped', 'P2P selection should offer stopped')
  equal(drawerButton.options[1].value, 'sender', 'P2P selection should offer sender')
  equal(drawerButton.options[2].value, 'receiver', 'P2P selection should offer receiver')
  equal(balloons[0], 'P2P: 停止', 'initial balloon should report the stopped state')

  await drawerButton.callback(robot, 'receiver')

  equal(openOptions.displayName, 'stackchan-receiver', 'receiver selection should open the receiver role')
  equal(subscribedType, 'text', 'receiver should subscribe to text messages')
  equal(balloons[2], '受信機: メッセージを待っています', 'receiver should display its ready state')

  messageHandler({
    peer: { id: 'peer-id', name: 'stackchan-sender', secure: false },
    payload: { text: 'hello\nworld 7\u202e' },
  })
  equal(balloons[3], 'hello world 7', 'receiver should display sanitized message text')

  messageHandler({
    peer: { id: 'peer-id', name: 'stackchan-sender', secure: false },
    payload: { text: 8 },
  })
  equal(balloons.length, 4, 'receiver should ignore invalid payload text')

  await drawerButton.callback(robot, 'stopped')
  equal(unsubscribeCount, 1, 'stopped selection should unsubscribe the receiver')
  equal(closeCount, 1, 'stopped selection should close the receiver session')
  equal(balloons[4], 'P2P: 停止', 'stopped selection should report the stopped state')

  trace('ok\n')
}

runTest().catch((error) => {
  trace(`local-peer-hello receiver test failed: ${String(error)}\n`)
  throw error
})
