import { defineApp } from 'stackchan'
import { type BeaconConnection, network } from 'stackchan/extensions/network'
import { ui } from 'stackchan/extensions/ui'
import { speeches } from './speeches_greeting'

export default defineApp({
  setup(app) {
    const controls = ui(app)
    const uuid = 'CFFD85BB-67E0-9CD4-B2D0-BE5A7ECAC915'
    let connection: BeaconConnection | undefined,
      sequence = 0,
      last = -1,
      pending = 0
    let audioMode = 'none'
    controls.addChoice(
      {
        id: 'audio',
        label: '挨拶の音声',
        value: audioMode,
        options: [
          { value: 'none', label: '文字だけ' },
          { value: 'clip', label: '用意した WAV' },
          { value: 'speech', label: '設定した音声合成' },
        ],
      },
      (value) => {
        audioMode = value
      },
    )
    const greet = async (command: number) => {
      const clips = Object.keys(speeches).filter((name) => name.startsWith(command === 1 ? 'hello_' : 'bye_'))
      const name = clips[Math.floor(Math.random() * clips.length)] as keyof typeof speeches
      app.ui.showBalloon(speeches[name])
      if (audioMode === 'clip') await app.audio.playClip(name)
      if (audioMode === 'speech') await app.audio.say(speeches[name])
    }
    controls.addChoice(
      {
        id: 'role',
        label: 'ビーコン',
        value: 'off',
        options: [
          { value: 'off', label: '停止' },
          { value: 'advertiser', label: '送信' },
          { value: 'scanner', label: '受信' },
        ],
      },
      async (role) => {
        await connection?.close()
        connection = undefined
        last = -1
        pending = 0
        if (role !== 'off')
          connection = network(app).beacon({
            role: role as 'advertiser' | 'scanner',
            uuid,
            onBeacon: (message) => {
              if (message.sequence === last || ![1, 2].includes(message.command)) return
              last = message.sequence
              pending = message.command
            },
          })
      },
    )
    for (const [command, label] of [
      [1, 'こんにちは'],
      [2, 'さようなら'],
    ] as const) {
      controls.addAction({ id: `greeting${command}`, label }, async () => {
        if (!connection) {
          app.ui.showBalloon('先に「送信」を選んでください')
          return
        }
        sequence = (sequence + 1) & 0xffff
        connection.advertise({ sequence, command })
        await greet(command)
      })
    }
    app.time.every(100, async () => {
      if (pending) {
        const command = pending
        pending = 0
        await greet(command)
      }
    })
  },
})
