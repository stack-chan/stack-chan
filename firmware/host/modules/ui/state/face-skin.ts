import { type FaceState, toPiuColorNumber, toPiuColorString } from 'face-state'
import { type Skin as PiuSkin, Skin } from 'piu/MC'

export type FaceSkinPalette = {
  primary: PiuSkin
  secondary: PiuSkin
  mixed: PiuSkin
  palette: PiuSkin
  primaryState: number
  secondaryState: number
  primaryColor: number
  secondaryColor: number
}

export function createFaceSkinPalette(primary: number, secondary: number): FaceSkinPalette {
  const primaryColor = toPiuColorString(primary)
  const secondaryColor = toPiuColorString(secondary)
  return {
    primary: new Skin({ fill: primaryColor, stroke: primaryColor }),
    secondary: new Skin({ fill: secondaryColor, stroke: secondaryColor }),
    mixed: new Skin({ fill: secondaryColor, stroke: primaryColor }),
    palette: new Skin({ fill: [secondaryColor, primaryColor], stroke: [secondaryColor, primaryColor] }),
    primaryState: 1,
    secondaryState: 0,
    primaryColor: primary,
    secondaryColor: secondary,
  }
}

export function updateFaceSkinPalette(prev: FaceSkinPalette | null, face: FaceState): FaceSkinPalette {
  const primary = toPiuColorNumber(face.theme.primary)
  const secondary = toPiuColorNumber(face.theme.secondary)
  if (prev && prev.primaryColor === primary && prev.secondaryColor === secondary) return prev
  return createFaceSkinPalette(primary, secondary)
}
