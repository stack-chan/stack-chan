import type { MiniAppDefinition } from 'capabilities'
import { Behavior, Container, Port, Skin } from 'piu/MC'

const background = new Skin({ fill: '#101214' })

class SamplePortBehavior extends Behavior {
  #x = 24
  #direction = 1

  onDisplaying(port: Port): void {
    port.interval = 32
    port.start()
  }

  onUndisplaying(port: Port): void {
    port.stop()
  }

  onTimeChanged(port: Port): void {
    this.#x += this.#direction * 3
    if (this.#x >= port.width - 24 || this.#x <= 24) this.#direction *= -1
    port.invalidate()
  }

  onDraw(port: Port): void {
    port.fillColor('#101214', 0, 0, port.width, port.height)
    port.fillColor('#42bde8', this.#x - 20, Math.floor(port.height / 2) - 20, 40, 40)
    port.fillColor('#ffffff', this.#x - 8, Math.floor(port.height / 2) - 7, 5, 5)
    port.fillColor('#ffffff', this.#x + 3, Math.floor(port.height / 2) - 7, 5, 5)
    port.fillColor('#101214', this.#x - 7, Math.floor(port.height / 2) + 7, 14, 3)
  }
}

const sample: MiniAppDefinition = Object.freeze({
  id: 'sample.piu',
  title: 'Piu サンプル',
  create() {
    return new Container(null, {
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
      skin: background,
      contents: [
        new Port(null, {
          left: 0,
          right: 0,
          top: 0,
          bottom: 0,
          Behavior: SamplePortBehavior,
        }),
      ],
    })
  },
})

export default Object.freeze([sample])
