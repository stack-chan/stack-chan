import type { Content as PiuContent, Skin as PiuSkin } from 'piu/MC'
import { defaultFaceContext, type FaceContext } from 'face-context'

export type MouthOptions = {
  cx: number
  cy: number
  minWidth?: number
  maxWidth?: number
  minHeight?: number
  maxHeight?: number
}

type PositionedContent = PiuContent & {
  left: number
  top: number
  width: number
  height: number
  coordinates?: {
    left?: number
    top?: number
    width?: number
    height?: number
  }
  skin?: PiuSkin
}

export const Mouth = Content.template((opts: MouthOptions) => {
  const minWidth = opts.minWidth ?? 50
  const maxWidth = opts.maxWidth ?? 90
  const minHeight = opts.minHeight ?? 8
  const maxHeight = opts.maxHeight ?? 58
  return {
    left: opts.cx - minWidth / 2,
    top: opts.cy - minHeight / 2,
    width: minWidth,
    height: minHeight,
    skin: new Skin({ fill: defaultFaceContext.theme.primary }),
    Behavior: class extends Behavior {
      cx = opts.cx
      cy = opts.cy
      minWidth = minWidth
      maxWidth = maxWidth
      minHeight = minHeight
      maxHeight = maxHeight
      lastOpen = -1
      lastPrimary: string | null = null
      onCreate(content: PositionedContent) {
        this.updateFromOpen(content, 0)
      }
      onFaceContext(content: PositionedContent, face: FaceContext) {
        const open = face.mouth.open
        if (open !== this.lastOpen) {
          this.updateFromOpen(content, open)
        }
        const primary = face.theme.primary
        if (primary !== this.lastPrimary) {
          this.lastPrimary = primary
          content.skin = new Skin({ fill: primary })
        }
      }
      updateFromOpen(content: PositionedContent, open: number) {
        this.lastOpen = open
        const h = this.minHeight + (this.maxHeight - this.minHeight) * open
        const w = this.minWidth + (this.maxWidth - this.minWidth) * (1 - open)
        content.coordinates = {
          left: this.cx - w / 2,
          top: this.cy - h / 2,
          width: w,
          height: h,
        }
      }
    },
  }
})
