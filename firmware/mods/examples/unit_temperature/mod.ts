import { defineApp } from 'stackchan'
import { sensors } from 'stackchan/extensions/sensors'
import { ui } from 'stackchan/extensions/ui'

export default defineApp({
  async setup(app) {
    await app.time.sleep(200)
    const sensor = sensors(app).openTemperature()
    const show = () => {
      const value = sensor.sample()
      app.ui.showBalloon(`${value.temperatureC.toFixed(2)} °C\n${value.relativeHumidityPercent.toFixed(2)} %`)
      app.time.after(10_000, () => app.ui.hideBalloon())
    }
    ui(app).addAction({ id: 'sample', label: '温度・湿度を測る' }, show)
    app.time.after(3_000, show)
    app.time.every(60_000, show)
  },
})
