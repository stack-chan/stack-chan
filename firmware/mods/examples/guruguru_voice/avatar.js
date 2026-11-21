// Behavior reference: nananauno/M5GuruguruAvatar (MIT), https://github.com/nananauno/M5GuruguruAvatar
export class GuruguruAvatar {
  constructor({ random = Math.random, invalidate = () => {} } = {}) {
    this.random = random
    this.invalidate = invalidate
    this.direction = 4
    this.state = 'idle'
    this.expression = 'neutral'
    this.eyeOpen = true
    this.mouth = 0
    this.elapsed = 0
    this.nextBlink = 2000 + random() * 3000
  }
  trackFace(x, y, width, height) {
    if (!(width > 0 && height > 0 && Number.isFinite(x) && Number.isFinite(y))) return
    const col = Math.max(0, Math.min(2, Math.floor((x * 3) / width)))
    const row = Math.max(0, Math.min(2, Math.floor((y * 3) / height)))
    this.direction = row * 3 + col
    this.invalidate()
  }
  setState(state) {
    if (!['idle', 'listen', 'think', 'speak'].includes(state)) throw new RangeError('Unknown avatar state')
    this.state = state
    if (state !== 'speak') this.mouth = 0
    this.invalidate()
  }
  setExpression(expression) {
    if (!['neutral', 'happy', 'sad'].includes(expression)) throw new RangeError('Unknown expression')
    this.expression = expression
    this.invalidate()
  }
  setLevel(value) {
    this.mouth = this.state === 'speak' && Number.isFinite(value) ? Math.max(0, Math.min(1, value * 6)) : 0
    this.invalidate()
  }
  tick(ms) {
    this.elapsed += ms
    if (this.elapsed < this.nextBlink) return
    this.eyeOpen = !this.eyeOpen
    this.nextBlink = this.elapsed + (this.eyeOpen ? 2000 + this.random() * 3000 : 120)
    this.invalidate()
  }
}
