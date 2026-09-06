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

// The controls and agent edits use the same shape transition and eyelid sizing.
export function updateFaceEye(eye: FaceEye, changes: Partial<FaceEye>) {
  const previous = { ...eye }
  Object.assign(eye, changes)
  if (eye.shape === 'roundRect') {
    eye.width = changes.width ?? previous.width ?? (previous.radius ?? 8) * 2
    eye.height = changes.height ?? previous.height ?? (previous.radius ?? 8) * 2
    eye.r = changes.r ?? previous.r ?? Math.min(eye.width / 2, 4)
    eye.eyelidWidth = eye.width
    eye.eyelidHeight = eye.height
  } else {
    eye.radius = changes.radius ?? previous.radius ?? Math.min(previous.width ?? 16, previous.height ?? 16) / 2
    eye.eyelidWidth = eye.radius * 2
    eye.eyelidHeight = eye.radius * 2
  }
}
