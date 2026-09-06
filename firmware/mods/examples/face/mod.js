import { defineApp } from 'stackchan'
import { ui } from 'stackchan/extensions/ui'

/** @type {{ emotion: import('stackchan/app').Emotion, text: string }[]} */
const states = [
  { emotion: 'happy', text: 'happyyyyyyyy' },
  { emotion: 'angry', text: 'ANGRY!!' },
  { emotion: 'sad', text: 'SAD...' },
  { emotion: 'sleepy', text: 'sleepy.' },
]

export default defineApp({
  setup(app) {
    const view = ui(app)
    app.face.setColor('primary', { r: 250, g: 250, b: 250 })
    view.addAction({ id: 'language', label: view.localize('localizedDrawer.label') }, () => view.closeMenu())
    let index = 0
    app.time.every(3000, () => {
      const { emotion, text } = states[index]
      app.face.setEmotion(emotion)
      view.showBalloon(text)
      view.setEmoticon(emotion === 'sleepy' ? 'sleepy' : null)
      index = (index + 1) % states.length
    })
    let hue = 0
    app.time.every(1000, () => {
      // Saturated HSL wheel at lightness 0.3, expressed as the SDK's RGB values.
      /** @param {number} offset */
      const channel = (offset) =>
        Math.round(153 * Math.max(0, Math.min(1, Math.abs((((hue + offset) / 60) % 6) - 3) - 1)))
      app.face.setColor('secondary', { r: channel(0), g: channel(240), b: channel(120) })
      hue = (hue + 20) % 360
    })
  },
})
