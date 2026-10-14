/** Approved 320x240 preview, in device pixels. All buffers live for the face lifetime. */
export const TOPOLOGY = ['MCC', 'MLLL', 'MCLC MCLC', 'MCLC', 'MCC', 'MLLL', 'MCLC MCLC', 'MCLC', 'MCC']
const COUNTS = [7, 4, 16, 8, 7, 4, 16, 8, 7]
const unit = (n: number, fallback: number) => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : fallback)
const gaze = (n: number) => (Number.isFinite(n) ? Math.max(-1, Math.min(1, n)) : 0)
export class JitomeGeometry {
  readonly points = COUNTS.map((count) => new Float32Array(count * 2))
  readonly previous = COUNTS.map((count) => new Float32Array(count * 2).fill(NaN))
  readonly bounds = new Int32Array(36)
  readonly dirty = new Int32Array(36)
  private initialized = false
  private readonly input = new Float64Array(7).fill(NaN)
  private ribbon(p: Float32Array, o: number, x1: number, y1: number, x2: number, y2: number, t: number, bend = 0) {
    const dx = (x2 - x1) / 3
    p[o++] = x1
    p[o++] = y1 - t / 2
    p[o++] = x1 + dx
    p[o++] = y1 + bend - t / 2
    p[o++] = x2 - dx
    p[o++] = y2 + bend - t / 2
    p[o++] = x2
    p[o++] = y2 - t / 2
    p[o++] = x2
    p[o++] = y2 + t / 2
    p[o++] = x2 - dx
    p[o++] = y2 + bend + t / 2
    p[o++] = x1 + dx
    p[o++] = y1 + bend + t / 2
    p[o++] = x1
    p[o] = y1 + t / 2
  }
  private eye(id: number, cx: number, side: number, open: number, gx: number, gy: number) {
    const blink = 1 - unit(open, 1),
      rx = 15.99,
      top = 131.25
    const height = 31.9 * (1 + gaze(gy) * 0.08),
      bottom = top + height
    const x = cx + gaze(gx) * 3.895,
      shoulder = top + height * 0.84
    let p = this.points[id]
    p[0] = x - rx
    p[1] = top
    p[2] = x - rx
    p[3] = shoulder
    p[4] = x - rx * 0.65
    p[5] = bottom
    p[6] = x
    p[7] = bottom
    p[8] = x + rx * 0.65
    p[9] = bottom
    p[10] = x + rx
    p[11] = shoulder
    p[12] = x + rx
    p[13] = top
    const cy = 127 + (height + 1) * blink
    p = this.points[id + 1]
    p[0] = cx - 32.5
    p[1] = 55
    p[2] = cx + 32.5
    p[3] = 55
    p[4] = cx + 32.5
    p[5] = cy + 4.25
    p[6] = cx - 32.5
    p[7] = cy + 4.25
    p = this.points[id + 2]
    this.ribbon(p, 0, cx - 20.5, cy, cx + 20.5, cy, 4.5)
    this.ribbon(p, 16, cx + side * 18.5, cy, cx + side * 24.5, cy - 2.2, 3.15)
    this.ribbon(this.points[id + 3], 0, cx - 12.71, 112.5 + 2 * blink, cx + 12.71, 112.5 + 2 * blink, 1.5, -0.5)
  }
  /** Returns a changed-part bitmask. Eye open=1 is the approved half-lidded neutral face. */
  update(
    leftOpen: number,
    rightOpen: number,
    leftX: number,
    leftY: number,
    rightX: number,
    rightY: number,
    mouthOpen: number,
  ) {
    const input = this.input
    if (
      input[0] === leftOpen &&
      input[1] === rightOpen &&
      input[2] === leftX &&
      input[3] === leftY &&
      input[4] === rightX &&
      input[5] === rightY &&
      input[6] === mouthOpen
    )
      return 0
    input[0] = leftOpen
    input[1] = rightOpen
    input[2] = leftX
    input[3] = leftY
    input[4] = rightX
    input[5] = rightY
    input[6] = mouthOpen
    this.eye(0, 102.5 + 4 / 1.5, -1, leftOpen, leftX, leftY)
    this.eye(4, 217.5 - 4 / 1.5, 1, rightOpen, rightX, rightY)
    const p = this.points[8],
      y = 174,
      open = unit(mouthOpen, 0),
      h = (0.9 + (0.14 + 0.86 * open) * 12) * 0.67 * (1 + 0.05 * open)
    p[0] = 154
    p[1] = y
    p[2] = 154
    p[3] = y + 0.5 - h
    p[4] = 166
    p[5] = y + 0.5 - h
    p[6] = 166
    p[7] = y
    p[8] = 166
    p[9] = y + 0.5 + h
    p[10] = 154
    p[11] = y + 0.5 + h
    p[12] = 154
    p[13] = y
    let mask = 0
    for (let id = 0; id < 9; id++) {
      const points = this.points[id],
        previous = this.previous[id],
        o = id * 4
      let changed = false,
        x = Infinity,
        y = Infinity,
        right = -Infinity,
        bottom = -Infinity
      const oldMaskBottom = previous[5]
      for (let i = 0; i < points.length; i += 2) {
        const px = Math.round((160 + (points[i] - 160) * 1.5) * 64) / 64
        const py = Math.round((144 + (points[i + 1] - 144) * 1.5) * 64) / 64
        points[i] = px
        points[i + 1] = py
        if (px !== previous[i] || py !== previous[i + 1]) changed = true
        previous[i] = px
        previous[i + 1] = py
        x = Math.min(x, px)
        y = Math.min(y, py)
        right = Math.max(right, px)
        bottom = Math.max(bottom, py)
      }
      if (!changed) continue
      mask |= 1 << id
      x = Math.floor(x) - 1
      y = Math.floor(y) - 1
      right = Math.ceil(right) + 1
      bottom = Math.ceil(bottom) + 1
      this.dirty[o] = this.initialized ? Math.min(x, this.bounds[o]) : x
      this.dirty[o + 1] = this.initialized ? Math.min(y, this.bounds[o + 1]) : y
      this.dirty[o + 2] = (this.initialized ? Math.max(right, this.bounds[o + 2]) : right) - this.dirty[o]
      this.dirty[o + 3] = (this.initialized ? Math.max(bottom, this.bounds[o + 3]) : bottom) - this.dirty[o + 1]
      // Only the moving lower edge changes this fixed-width mask, not its entire area.
      if (this.initialized && (id === 1 || id === 5)) {
        this.dirty[o + 1] = Math.floor(Math.min(oldMaskBottom, points[5])) - 1
        this.dirty[o + 3] = Math.ceil(Math.max(oldMaskBottom, points[5])) + 1 - this.dirty[o + 1]
      }
      this.bounds[o] = x
      this.bounds[o + 1] = y
      this.bounds[o + 2] = right
      this.bounds[o + 3] = bottom
    }
    this.initialized = true
    return mask
  }
}
