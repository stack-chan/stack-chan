import {
  createFaceAsset,
  FACE_ASSET_MEDIA_TYPE,
  parseFaceAsset,
  shapeFaceDefinition,
  type FaceAsset,
  type FaceCanvas,
  type FaceEmotion,
  type FaceEye,
  type FaceMouth,
} from '../../../editor/face-assets.mjs'

export type { FaceAsset, FaceCanvas, FaceEmotion, FaceEye, FaceMouth }

export type FaceEditContext = { projectId: string; assetPath: string }

export const normalizeFaceAsset = createFaceAsset
export const parseFaceAssetFile = parseFaceAsset
export const generateShapeFace = shapeFaceDefinition
export const faceAssetMediaType = FACE_ASSET_MEDIA_TYPE

export const cloneFaceAsset = (asset: FaceAsset): FaceAsset => structuredClone(asset)
