import { defineApp, type Unsubscribe } from 'stackchan'
import { network, type PeerConnection } from 'stackchan/extensions/network'
import { ui } from 'stackchan/extensions/ui'
import { extractReceivedText } from './message-text'

export default defineApp({
  setup(app) {
    let session: PeerConnection | undefined,
      stopTimer: Unsubscribe | undefined,
      sequence = 0
    ui(app).addChoice(
      {
        id: 'role',
        label: '近くのスタックチャン',
        value: 'stopped',
        options: [
          { value: 'stopped', label: '停止' },
          { value: 'sender', label: '送信' },
          { value: 'receiver', label: '受信' },
        ],
      },
      async (role) => {
        stopTimer?.()
        stopTimer = undefined
        await session?.close()
        session = undefined
        if (role === 'stopped') {
          app.ui.hideBalloon()
          return
        }
        const peer = await network(app).openPeer({
          service: 'tech.stackchan.examples.hello',
          displayName: `stackchan-${role}`,
        })
        session = peer
        if (role === 'receiver') {
          peer.onMessage('text', (message) => {
            const text = extractReceivedText(message.payload)
            if (text) app.ui.showBalloon(text)
          })
          app.ui.showBalloon('受信を待っています')
        } else {
          stopTimer = app.time.every(3000, async (task) => {
            const found = await peer.discover({ timeoutMs: 1000, signal: task.signal })
            const receiver = found.find((candidate) => candidate.name === 'stackchan-receiver')
            if (!receiver) {
              app.ui.showBalloon('受信側を探しています')
              return
            }
            sequence = (sequence % 999999) + 1
            await peer.send(receiver.id, 'text', { text: `こんにちは ${sequence}` }, { signal: task.signal })
            app.ui.showBalloon(`送信しました ${sequence}`)
          })
        }
      },
    )
  },
})
