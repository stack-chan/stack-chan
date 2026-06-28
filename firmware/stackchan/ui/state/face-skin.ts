import type { FaceContext } from 'face-context'
import { type Skin as PiuSkin, Skin } from 'piu/MC'

export type FaceSkinPalette = {
  primary: PiuSkin
  secondary: PiuSkin
  mixed: PiuSkin
  palette: PiuSkin
  primaryState: number
  secondaryState: number
  primaryColor: string
  secondaryColor: string
}

export function createFaceSkinPalette(primary: string, secondary: string): FaceSkinPalette {
  return {
    primary: new Skin({ fill: primary, stroke: primary }),
    secondary: new Skin({ fill: secondary, stroke: secondary }),
    mixed: new Skin({ fill: secondary, stroke: primary }),
    palette: new Skin({ fill: [secondary, primary], stroke: [secondary, primary] }),
    primaryState: 1,
    secondaryState: 0,
    primaryColor: primary,
    secondaryColor: secondary,
  }
}

export function updateFaceSkinPalette(prev: FaceSkinPalette | null, face: Readonly<FaceContext>): FaceSkinPalette {
  const primary = face.theme.primary
  const secondary = face.theme.secondary
  if (prev && prev.primaryColor === primary && prev.secondaryColor === secondary) return prev
  return createFaceSkinPalette(primary, secondary)
}
