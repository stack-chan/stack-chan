import { GuruguruAvatar } from 'guruguru-avatar'
import { Behavior, Port } from 'piu/MC'

class AvatarBehavior extends Behavior {
  onCreate(_port, model) {
    this.model = model
  }
  onDisplaying(port) {
    port.interval = 40
    port.start()
  }
  onUndisplaying(port) {
    port.stop()
  }
  onTimeChanged(_port) {
    this.model.tick(40)
  }
  onTouchBegan(port, id, x, y, ticks) {
    port.captureTouch(id, x, y, ticks)
    this.onTouchMoved(port, id, x, y)
  }
  onTouchMoved(port, _id, x, y) {
    this.model.trackFace(x - port.x, y - port.y, port.width, port.height)
  }
  onDraw(port) {
    const m = this.model
    const w = port.width,
      h = port.height
    const dx = (m.direction % 3) - 1,
      dy = Math.floor(m.direction / 3) - 1
    const cx = w / 2 + dx * w * 0.06,
      cy = h / 2 + dy * h * 0.06
    const colors = { idle: '#e8f0ef', listen: '#75ddbe', think: '#f3ca72', speak: '#a7c7ff' }
    port.fillColor('#101820', 0, 0, w, h)
    port.fillColor(colors[m.state], cx - w * 0.3, cy - h * 0.25, w * 0.6, h * 0.5)
    const eyeHeight = m.eyeOpen ? h * 0.07 : 3
    for (const side of [-1, 1])
      port.fillColor('#101820', cx + side * w * 0.15 + dx * 8 - 8, cy - h * 0.08 + dy * 6, 16, eyeHeight)
    const mouthWidth = m.expression === 'happy' ? 54 : 32
    port.fillColor('#101820', cx - mouthWidth / 2, cy + h * 0.12, mouthWidth, 3 + m.mouth * h * 0.09)
    if (m.expression === 'sad') port.fillColor('#101820', cx - 20, cy + h * 0.1, 40, 3)
  }
}

export function createGuruguruView() {
  let content
  const model = new GuruguruAvatar({ invalidate: () => content?.invalidate() })
  content = new Port(model, { left: 0, right: 0, top: 0, bottom: 0, active: true, Behavior: AvatarBehavior })
  return {
    model,
    content,
    close() {
      content.stop()
    },
  }
}
