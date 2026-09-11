import { defineApp } from 'stackchan'
import { streamingAudio } from 'stackchan/extensions/audio'
import type { Connection } from 'stackchan/extensions/network'
import { ui } from 'stackchan/extensions/ui'

export default defineApp({
  async setup(app) {
    let microphone: Connection | undefined
    const start = async () => {
      microphone = await streamingAudio(app).monitor((level) =>
        app.face.setMouthOpen(Math.min(1, (level * 32768) / 150)),
      )
    }
    ui(app).addToggle({ id: 'listen', label: 'マイクで口を動かす', value: true }, async (enabled) => {
      await microphone?.close()
      microphone = undefined
      app.face.setMouthOpen(0)
      if (enabled) await start()
    })
    await start()
  },
})
