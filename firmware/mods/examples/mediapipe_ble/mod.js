import { Hands } from 'hands'
import { MEDIAPIPE_BLE_MESSAGE_TYPE, MEDIAPIPE_BLE_SERVICE } from 'mediapipe-tracking-message'
import { TRACKING_TICK_MS, TrackingReceiver } from 'mediapipe-tracking-receiver'
import Timer from 'timer'

const DISPLAY_NAME = 'stackchan-mediapipe'
const EFFECT_KEY = 'mediapipe-tracked-hands'

async function startTracking(robot) {
  const localPeer = robot.connectivity.localPeer
  if (!localPeer) {
    trace('[mediapipe-ble] BLE Local Peer is unavailable on this device\n')
    return
  }

  const session = await localPeer.open({
    transport: 'ble',
    service: MEDIAPIPE_BLE_SERVICE,
    displayName: DISPLAY_NAME,
  })
  // Keep the face clock running: it applies both the built-in blink/breath
  // motions and face-state updates received from this MOD.
  const hands = new Hands({})
  robot.ui.addEffect(hands, EFFECT_KEY)
  const receiver = new TrackingReceiver(robot, hands)
  session.subscribe(MEDIAPIPE_BLE_MESSAGE_TYPE, (message) => {
    if (!receiver.receive(message.payload)) {
      trace(`[mediapipe-ble] rejected invalid payload from ${message.peer.id}\n`)
    }
  })
  Timer.repeat(() => receiver.tick(), TRACKING_TICK_MS)
  trace('[mediapipe-ble] ready for a browser connection\n')
}

export function onContextCreated(robot) {
  void startTracking(robot).catch((error) => {
    trace(`[mediapipe-ble] startup failed: ${error?.message ?? error}\n`)
  })
}
