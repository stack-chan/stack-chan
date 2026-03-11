import type { Content as PiuContent, Skin as PiuSkin } from 'piu/MC'
import { defaultFaceContext, toColorString, type FaceContext } from 'face-context'
import { getSolidSkin } from 'skin-cache'

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

export function createMouth({
  cx,
  cy,
  minWidth = 50,
  maxWidth = 90,
  minHeight = 8,
  maxHeight = 58,
}: MouthOptions): PositionedContent {
  return new Content(null, {
    left: cx - minWidth / 2,
    top: cy - minHeight / 2,
    width: minWidth,
    height: minHeight,
    skin: getSolidSkin(toColorString(defaultFaceContext.theme.primary)),
    Behavior: class extends Behavior {
      cx = cx
      cy = cy
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
        const primary = toColorString(face.theme.primary)
        if (primary !== this.lastPrimary) {
          this.lastPrimary = primary
          content.skin = getSolidSkin(primary)
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
  }) as PositionedContent
}
