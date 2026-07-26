import type { FaceSkinPalette } from 'face-skin'
import { DEFAULT_FACE_PRIMARY_COLOR, DEFAULT_FACE_SECONDARY_COLOR, type FaceState, toPiuColorNumber } from 'face-state'
import { quantizeUnit } from 'parts/unit-steps'
import type { Port as PiuPort } from 'piu/MC'

abstract class FaceColorBehavior extends Behavior {
  #hasPalette = false
  protected abstract color: number

  protected abstract colorFromFace(face: FaceState): number
  protected abstract colorFromPalette(palette: FaceSkinPalette): number

  onFaceSkin(port: PiuPort, palette: FaceSkinPalette): void {
    this.#hasPalette = true
    this.setColor(port, this.colorFromPalette(palette))
  }

  onFaceState(port: PiuPort, face: FaceState): void {
    if (!this.#hasPalette) this.setColor(port, this.colorFromFace(face))
  }

  protected onColorChanged(port: PiuPort): void {
    port.invalidate()
  }

  private setColor(port: PiuPort, color: number): void {
    if (color === this.color) return
    this.color = color
    this.onColorChanged(port)
  }
}

export class FacePrimaryColorBehavior extends FaceColorBehavior {
  protected color = DEFAULT_FACE_PRIMARY_COLOR

  protected colorFromFace(face: FaceState): number {
    return toPiuColorNumber(face.theme.primary)
  }

  protected colorFromPalette(palette: FaceSkinPalette): number {
    return palette.primaryColor
  }
}

export class FaceSecondaryColorBehavior extends FaceColorBehavior {
  protected color = DEFAULT_FACE_SECONDARY_COLOR

  protected colorFromFace(face: FaceState): number {
    return toPiuColorNumber(face.theme.secondary)
  }

  protected colorFromPalette(palette: FaceSkinPalette): number {
    return palette.secondaryColor
  }
}

export abstract class QuantizedMouthMaskBehavior extends FacePrimaryColorBehavior {
  #lastOpenStep = -1
  revision = 0

  onCreate(port: PiuPort): void {
    this.updateOpen(port, 0)
  }

  override onFaceState(port: PiuPort, face: FaceState): void {
    super.onFaceState(port, face)
    this.updateOpen(port, quantizeUnit(face.mouth.open))
  }

  protected abstract updateMask(openStep: number): void

  private updateOpen(port: PiuPort, openStep: number): void {
    if (openStep === this.#lastOpenStep) return
    this.#lastOpenStep = openStep
    this.updateMask(openStep)
    this.revision++
    port.invalidate()
  }
}
