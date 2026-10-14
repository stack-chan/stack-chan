import { Outline } from 'commodetto/outline'
import { type FaceSkinPalette, updateFaceSkinPalette } from 'face-skin'
import { copyFaceState, createFaceState, type FaceState } from 'face-state'
import { JitomeGeometry, TOPOLOGY } from 'jitome-face/geometry'
import { Container, type Container as PiuContainer, type Port as PiuPort, Port } from 'piu/MC'
import type { Shape as PiuShape } from 'piu/shape'
import 'piu/shape'

interface ReusableOutline extends Outline {
  readonly byteLength: number
  clone(destination?: Outline): Outline
}

const OUTLINE_PARTS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 8]
const MOUTH_BASELINE = 189
let reusableOutlineSupport: boolean | undefined

/** Whether the active Moddable SDK can render the built-in Jitome face. */
export function isJitomeFaceSupported(): boolean {
  if (reusableOutlineSupport !== undefined) return reusableOutlineSupport
  try {
    const source = Outline.fill(Outline.PolygonPath(0, 0, 2, 0, 0, 2)) as ReusableOutline
    const destination = source.clone() as ReusableOutline
    reusableOutlineSupport =
      source.clone(destination) === destination && typeof (Port.prototype as PiuPort).invalidate === 'function'
  } catch {
    reusableOutlineSupport = false
  }
  return reusableOutlineSupport
}

class JitomeBehavior extends Behavior {
  readonly breathPixels = 0
  readonly preservePositionOnSwap = false
  readonly desired = createFaceState()
  readonly geometry = new JitomeGeometry()
  readonly references: Float32Array[] = []
  readonly bases: ReusableOutline[] = []
  readonly shapes: PiuShape[] = []
  readonly outlines: ReusableOutline[] = []
  readonly base = { left: 0, top: 0 }
  invalidator: PiuPort | null = null
  palette: FaceSkinPalette | null = null
  enabled = true
  displayed = false
  paused = false
  elapsed = 0
  nextBlink = 2800
  blinkTime = -1
  lastTime = 0
  onCreate(content: PiuContainer) {
    content.interval = 33
  }
  private createPath(id: number) {
    const path = new Outline.FreeTypePath(),
      points = this.geometry.points[id]
    let offset = 0
    for (const contour of TOPOLOGY[id].split(' ')) {
      for (const command of contour) {
        if (command === 'M') path.beginSubpath(points[offset++], points[offset++])
        else if (command === 'L') path.lineTo(points[offset++], points[offset++])
        else
          path.cubicTo(
            points[offset++],
            points[offset++],
            points[offset++],
            points[offset++],
            points[offset++],
            points[offset++],
          )
      }
      path.endSubpath()
    }
    if (offset !== points.length) throw new Error('JitomeFace: unexpected Outline topology')
    return path
  }
  private transformOutline(index: number) {
    const id = OUTLINE_PARTS[index],
      points = this.geometry.points[id],
      reference = this.references[id],
      destination = this.outlines[index],
      outline = this.bases[id].clone(destination) as ReusableOutline
    if (outline !== destination) throw new Error('JitomeFace requires Moddable SDK 9.5.0 or later')
    if (id === 0 || id === 4) {
      const scale = (points[7] - points[1]) / (reference[7] - reference[1])
      outline
        .translate(0, -reference[1])
        .scale(1, scale)
        .translate(points[6] - reference[6], reference[1])
    } else if (id === 1 || id === 5) {
      const scale = (points[5] - points[1]) / (reference[5] - reference[1])
      outline.translate(0, -reference[1]).scale(1, scale).translate(0, reference[1])
    } else if (id === 2 || id === 3 || id === 6 || id === 7) {
      outline.translate(0, points[1] - reference[1])
    } else if (index === 8) {
      const scale = (points[3] - points[1]) / (reference[3] - reference[1])
      outline.translate(0, -MOUTH_BASELINE).scale(1, scale).translate(0, MOUTH_BASELINE)
    } else {
      const scale = (points[9] - points[7]) / (reference[9] - reference[7])
      outline.translate(0, -MOUTH_BASELINE).scale(1, scale)
    }
  }
  attach(content: PiuContainer) {
    this.geometry.update(1, 1, 0, 0, 0, 0, 0)
    for (let id = 0; id < TOPOLOGY.length; id++) {
      this.references.push(this.geometry.points[id].slice())
      this.bases.push(Outline.fill(this.createPath(id)) as ReusableOutline)
    }
    for (let index = 0; index < OUTLINE_PARTS.length; index++) {
      const id = OUTLINE_PARTS[index],
        outline = this.bases[id].clone() as ReusableOutline,
        lowerMouth = index === 9,
        shape = new Shape(null, {
          left: 0,
          top: lowerMouth ? MOUTH_BASELINE : 0,
          width: 320,
          height: lowerMouth ? 240 - MOUTH_BASELINE : index === 8 ? MOUTH_BASELINE : 240,
        }) as PiuShape
      this.outlines.push(outline)
      if (lowerMouth) this.transformOutline(index)
      shape.fillOutline = outline
      this.shapes.push(shape)
      content.add(shape)
    }
    this.invalidator = new Port(null, { left: 0, top: 0, width: 320, height: 240 }) as PiuPort
    content.add(this.invalidator)
    this.applySkin(content, updateFaceSkinPalette(null, this.desired))
  }
  applySkin(content: PiuContainer, palette: FaceSkinPalette) {
    if (palette === this.palette) return
    this.palette = palette
    content.skin = palette.secondary
    for (let i = 0; i < this.shapes.length; i++)
      this.shapes[i].skin = i === 1 || i === 5 ? palette.secondary : palette.primary
  }
  onFaceSkin(content: PiuContainer, palette: FaceSkinPalette) {
    this.applySkin(content, palette)
  }
  onFaceUpdate(content: PiuContainer, state: FaceState) {
    copyFaceState(state, this.desired)
    this.applySkin(content, updateFaceSkinPalette(this.palette, state))
    if (!this.enabled && !this.paused) this.render(1)
  }
  onFaceState(content: PiuContainer, state: FaceState) {
    this.onFaceUpdate(content, state)
  }
  rehydrate(content: PiuContainer, state: FaceState, palette?: FaceSkinPalette | null) {
    this.onFaceUpdate(content, state)
    if (palette) this.applySkin(content, palette)
    this.lastTime = content.time
    this.render(1)
  }
  onDisplaying(content: PiuContainer) {
    this.displayed = true
    this.lastTime = content.time
    this.render(1)
    if (this.enabled && !this.paused) content.start()
  }
  onUndisplaying(content: PiuContainer) {
    this.displayed = false
    content.stop()
  }
  onTimeChanged(content: PiuContainer) {
    if (!this.enabled || this.paused || !this.displayed) return
    const dt = Math.max(0, Math.min(100, content.time - this.lastTime))
    this.lastTime = content.time
    this.elapsed += dt
    let openness = 1
    if (this.blinkTime < 0 && this.elapsed >= this.nextBlink) this.blinkTime = 0
    if (this.blinkTime >= 0) {
      this.blinkTime += dt
      const t = this.blinkTime
      // Close, hold fully shut, then reopen. No gaze motion is injected during a blink.
      openness = t < 90 ? 1 - t / 90 : t < 135 ? 0 : Math.min(1, (t - 135) / 200)
      if (t >= 335) {
        this.blinkTime = -1
        this.nextBlink = this.elapsed + 2800 + Math.random() * 2200
      }
    }
    this.render(openness)
  }
  render(openness: number) {
    const state = this.desired,
      left = state.eyes.left,
      right = state.eyes.right
    const changed = this.geometry.update(
      left.open * openness,
      right.open * openness,
      left.gazeX,
      left.gazeY,
      right.gazeX,
      right.gazeY,
      state.mouth.open,
    )
    for (let index = 0; index < OUTLINE_PARTS.length; index++)
      if (changed & (1 << OUTLINE_PARTS[index])) this.transformOutline(index)
    for (let id = 0; id < 9; id++) {
      if (!(changed & (1 << id)) || !this.invalidator) continue
      const o = id * 4,
        d = this.geometry.dirty
      this.invalidator.invalidate(d[o], d[o + 1], d[o + 2], d[o + 3])
    }
  }
  getBaseCoordinates(content: PiuContainer) {
    this.base.left = content.coordinates.left ?? 0
    this.base.top = content.coordinates.top ?? 0
    return this.base
  }
  setMotionsEnabled(content: PiuContainer, enabled: boolean) {
    this.enabled = enabled
    this.blinkTime = -1
    this.lastTime = content.time
    if (enabled && this.displayed && !this.paused) content.start()
    else content.stop()
    if (!this.paused) this.render(1)
  }
  pause(content: PiuContainer) {
    this.paused = true
    content.stop()
    content.visible = false
    content.active = false
  }
  resume(content: PiuContainer) {
    this.paused = false
    content.visible = true
    content.active = true
    this.lastTime = content.time
    this.render(1)
    if (this.enabled && this.displayed) content.start()
  }
  onTouchEnded(content: PiuContainer) {
    content.bubble('onFaceTouch')
  }
}
/** CoreS3 320x240 face matching the approved preview. No lower eyelid or body motion. */
export function createJitomeFace(): { readonly content: PiuContainer } {
  if (!isJitomeFaceSupported()) throw new Error('JitomeFace requires Moddable SDK 9.5.0 or later')
  const behavior = new JitomeBehavior()
  const content = new Container(null, { left: 0, top: 0, width: 320, height: 240, clip: true, active: true, behavior })
  behavior.attach(content)
  return { content }
}
