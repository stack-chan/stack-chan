import { defineApp } from 'stackchan'

export default defineApp({
  setup(app) {
    app.face.setColor('primary', { r: 0x30, g: 0xe0, b: 0xff })
    app.face.setColor('secondary', { r: 0xff, g: 0x70, b: 0xd8 })
    app.ui.showBalloon('sample .xsa OK')
    trace('[sample-mod] ready\n')
  },
})
