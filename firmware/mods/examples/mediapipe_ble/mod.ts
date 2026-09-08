import { defineApp } from 'stackchan'
import { network } from 'stackchan/extensions/network'
import { MEDIAPIPE_BLE_MESSAGE_TYPE, MEDIAPIPE_BLE_SERVICE } from './tracking-message'
import { TRACKING_TICK_MS, TrackingReceiver } from './tracking-receiver'

export default defineApp({
  async setup(app) {
    const receiver = new TrackingReceiver(app)
    const peer = await network(app).openPeer({
      transport: 'ble',
      service: MEDIAPIPE_BLE_SERVICE,
      displayName: 'stackchan-mediapipe',
    })
    peer.onMessage(MEDIAPIPE_BLE_MESSAGE_TYPE, (message) => {
      receiver.receive(message.payload)
    })
    app.time.every(TRACKING_TICK_MS, () => receiver.tick())
    app.ui.showBalloon('MediaPipe BLE の姿勢を待っています')
  },
})
