import { defineApp } from 'stackchan'
import { streamingAudio } from 'stackchan/extensions/audio'
import { type Connection, network } from 'stackchan/extensions/network'
import { ui } from 'stackchan/extensions/ui'

const stations = [
  ['groovesalad', 'Groove Salad'],
  ['dronezone', 'Drone Zone'],
  ['deepspaceone', 'Deep Space One'],
  ['spacestation', 'Space Station'],
  ['secretagent', 'Secret Agent'],
  ['beatblender', 'Beat Blender'],
  ['indiepop', 'Indie Pop'],
] as const
export default defineApp({
  async setup(app) {
    const controls = ui(app)
    let radio: Connection | undefined
    const select = async (station: string) => {
      await radio?.close()
      radio = undefined
      controls.setMusicNotes(false)
      controls.setFaceMotionEnabled(true)
      if (station === 'off') {
        app.ui.hideBalloon()
        return
      }
      await network(app).ready()
      controls.setFaceMotionEnabled(false)
      radio = await streamingAudio(app).radio({
        url:
          station === 'radioparadise'
            ? 'http://stream-tx1.radioparadise.com/mp3-128'
            : `http://ice2.somafm.com/${station}-128-mp3`,
        volume: 0.2,
        reconnect: true,
        onState: (state, reason) => {
          controls.setMusicNotes(state === 'playing')
          if (state === 'playing') app.ui.hideBalloon()
          else app.ui.showBalloon(reason ?? state)
          if (state === 'error' || state === 'idle') controls.setFaceMotionEnabled(true)
        },
      })
    }
    controls.addChoice(
      {
        id: 'station',
        label: 'ラジオ局',
        value: 'groovesalad',
        options: [
          { value: 'off', label: '停止' },
          ...stations.map(([value, label]) => ({ value, label })),
          { value: 'radioparadise', label: 'Radio Paradise' },
        ],
      },
      select,
    )
    await select('groovesalad')
  },
})
