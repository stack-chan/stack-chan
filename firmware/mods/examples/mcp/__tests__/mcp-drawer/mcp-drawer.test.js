import { setMCPServerResult } from 'mcp-server'
import { onContextCreated } from 'mod'
import { setIPAddress } from 'net'
import { assert, equal } from 'testing/assert'

function createContext(ready = { status: 'connected' }) {
  const buttons = []
  const states = []
  const balloons = []
  let hidden = 0
  const context = {
    connectivity: {
      network: {
        ready: Promise.resolve(ready),
      },
    },
    ui: {
      drawer: {
        addDrawerButton(button) {
          buttons.push(button)
        },
        setDrawerButtonState(key, active) {
          states.push([key, active])
        },
      },
      showBalloon(message) {
        balloons.push(message)
      },
      hideBalloon() {
        hidden += 1
      },
    },
    face: {
      setEmotion() {},
    },
    audio: {
      say() {
        return Promise.resolve({ success: true, value: 'ok' })
      },
    },
  }
  return {
    context,
    buttons,
    states,
    balloons,
    get hidden() {
      return hidden
    },
  }
}

async function runTest() {
  setMCPServerResult('running')
  setIPAddress('192.168.7.146')
  const connected = createContext()
  onContextCreated(connected.context)
  equal(connected.buttons.length, 1, 'MCP MOD should register one drawer button')
  const button = connected.buttons[0]
  equal(button.key, 'mcp-server:endpoint', 'drawer button should have a stable key')
  equal(button.kind, 'toggle', 'endpoint control should be a toggle')
  equal(button.initialState, false, 'endpoint balloon should start hidden')

  await button.callback(connected.context)
  equal(connected.states[0][1], true, 'first toggle should become active')
  equal(
    connected.balloons[0],
    'MCP server:\nhttp://192.168.7.146:8080/mcp',
    'connected server should show its MCP endpoint',
  )
  await button.callback(connected.context)
  equal(connected.states[1][1], false, 'second toggle should become inactive')
  equal(connected.hidden, 1, 'second toggle should hide the endpoint balloon')

  setMCPServerResult('running')
  const offline = createContext({ status: 'failed', reason: 'connection failed' })
  onContextCreated(offline.context)
  await offline.buttons[0].callback(offline.context)
  equal(
    offline.balloons[0],
    'MCP server unavailable:\nconnection failed',
    'offline server should show the network failure',
  )

  const rejected = createContext()
  rejected.context.connectivity.network.ready = Promise.reject(new Error('Wi-Fi initialization failed'))
  onContextCreated(rejected.context)
  await rejected.buttons[0].callback(rejected.context)
  assert(rejected.balloons[0].includes('Wi-Fi initialization failed'), 'network readiness rejection should be visible')

  setMCPServerResult('failed', 'port already in use')
  const failed = createContext()
  onContextCreated(failed.context)
  await failed.buttons[0].callback(failed.context)
  equal(failed.balloons[0], 'MCP server error:\nport already in use', 'listener failure should be visible')

  setMCPServerResult('running')
  setIPAddress(undefined)
  const missingAddress = createContext()
  onContextCreated(missingAddress.context)
  await missingAddress.buttons[0].callback(missingAddress.context)
  assert(missingAddress.balloons[0].includes('IP address is not available'), 'missing IP address should be visible')

  trace('ok\n')
}

runTest().catch((error) => {
  trace(`MCP drawer test failed: ${String(error)}\n`)
  throw error
})
