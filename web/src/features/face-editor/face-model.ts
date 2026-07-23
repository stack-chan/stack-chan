import {
  createFaceAsset,
  FACE_ASSET_MEDIA_TYPE,
  parseFaceAsset,
  shapeFaceDefinition,
} from '../../../editor/face-assets.mjs'

export type FaceEmotion = 'NEUTRAL' | 'HAPPY' | 'ANGRY' | 'SAD' | 'SLEEPY' | 'DOUBTFUL' | 'COLD' | 'HOT'

export type FaceCanvas = {
  left: number
  top: number
  width: number
  height: number
}

export type FaceEye = {
  x: number
  y: number
  shape: 'circle' | 'roundRect'
  radius?: number
  width?: number
  height?: number
  r?: number
  eyelidWidth: number
  eyelidHeight: number
}

export type FaceMouth = {
  visible: boolean
  x: number
  y: number
  minWidth: number
  maxWidth: number
  minHeight: number
  maxHeight: number
}

export type FaceAsset = {
  format: 'tech.stackchan.face'
  version: 1
  kind: 'shape'
  name: string
  emotion: FaceEmotion
  colors: { primary: string; secondary: string }
  mouth: number
  canvas: FaceCanvas
  shape: {
    eyes: { left: FaceEye; right: FaceEye }
    mouth: FaceMouth
  }
}

export type FaceEditContext = { projectId: string; assetPath: string }

export const normalizeFaceAsset = createFaceAsset as unknown as (asset?: Partial<FaceAsset>) => FaceAsset
export const parseFaceAssetFile = parseFaceAsset as unknown as (source: string) => FaceAsset
export const generateShapeFace = shapeFaceDefinition as unknown as (asset: FaceAsset) => string
export const faceAssetMediaType = FACE_ASSET_MEDIA_TYPE as string

export const cloneFaceAsset = (asset: FaceAsset): FaceAsset => structuredClone(asset)
