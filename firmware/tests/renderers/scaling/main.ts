import { Renderer } from 'simple-face'
import Timer from 'timer'
import qrCode from 'qrcode'
import config from 'mc/config'
import 'pocoqrcode'

const qr = qrCode({ input: 'https://discord.gg/zkp9DQz67F' })
const size = qr.size
const code = new Uint8Array(qrCode({ input: '' }))
// trace QR code to console
for (let y = 0; y < size; y++) {
  for (let x = 0; x < size; x++) {
    if (code[y * size + x]) trace('X')
    else trace('.')
  }
  trace('\n')
}
const INTERVAL = 1000 / 30
const renderer = new Renderer({})
renderer.setScale(1.0, 0.5)
renderer.setOffset(0, 30)
let t = 0

const render = renderer._poco
let margin = 10
let available = Math.min(render.width - margin * 2, render.height - margin * 2)
let pixels = Math.idiv(available, size)
margin += (available - pixels * size) >> 1

let qrX = Math.idiv(render.width - qr.size * 3, 2)
let qrY = 140
if (config.rotation == 90) {
  // 左下からのオフセットに変換する
  const s = qr.size * 3
  const x = render.height - qrY - s
  const y = qrX
  qrX = x
  qrY = y
}

render.begin()
render.fillRectangle(render.makeColor(0, 0, 0), 0, 0, render.width, render.height)
render.fillRectangle(render.makeColor(255, 255, 255), 0, render.height / 2, render.width, render.height / 2)
render.drawQRCode(qr, qrX, qrY, 3, render.makeColor(0, 0, 255))
render.end()

Timer.repeat(() => {
  const offsetX = Math.sin((t / 360) * Math.PI) * 30
  renderer.setOffset(offsetX, 30)
  renderer.update(INTERVAL)
  t += 10
}, INTERVAL)
