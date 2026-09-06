import { defineApp } from 'stackchan'

export default defineApp({
  setup(app) {
    if (app.camera.info.availability === 'unavailable') {
      app.ui.showBalloon('この機種ではカメラを使えません')
      return
    }
    app.ui.showBalloon('ボタンを押すと写真を撮ります')
    app.input.onPress('primary', async (task) => {
      const image = await app.camera.capture({ width: 176, height: 144, signal: task.signal })
      app.ui.showImage(image)
    })
  },
})
