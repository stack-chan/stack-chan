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

export type DeepPartial<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepPartial<Item>[]
    : T extends object
      ? { [Key in keyof T]?: DeepPartial<T[Key]> }
      : T

export type FaceAssetInput = {
  name?: string
  emotion?: FaceEmotion
  primary?: string
  secondary?: string
  colors?: DeepPartial<FaceAsset['colors']>
  mouth?: number
  canvas?: DeepPartial<FaceCanvas>
  shape?: {
    eyes?: {
      left?: DeepPartial<FaceEye>
      right?: DeepPartial<FaceEye>
    }
    mouth?: DeepPartial<FaceMouth>
  }
}

export type FaceAssetProject = {
  assets: Array<{
    path: string
    mediaType: string
    encoding: 'base64' | 'utf8'
    data: string
  }>
  settings: {
    faceAsset: string | null
  } & Record<string, unknown>
}

export const FACE_ASSET_FORMAT: 'tech.stackchan.face'
export const FACE_ASSET_VERSION: 1
export const FACE_ASSET_MEDIA_TYPE: 'application/vnd.stackchan.face+json'
export const FACE_ASSET_KIND_SHAPE: 'shape'
export const FACE_ASSET_EYE_SHAPES: readonly ['circle', 'roundRect']
export const FACE_ASSET_EMOTIONS: readonly FaceEmotion[]
export const DEFAULT_SHAPE_FACE: Readonly<{
  canvas: Readonly<FaceCanvas>
  shape: Readonly<{
    eyes: Readonly<{
      left: Readonly<FaceEye>
      right: Readonly<FaceEye>
    }>
    mouth: Readonly<FaceMouth>
  }>
}>

export function createFaceAsset(input?: FaceAssetInput): FaceAsset
export function parseFaceAsset(source: string): FaceAsset
export function addFaceAssetToProject<Project extends FaceAssetProject>(
  project: Project,
  asset: FaceAsset,
  options?: { replacePath?: string | null }
): Project
export function shapeFaceDefinition(asset: FaceAsset | FaceAssetInput): string
export function faceAssetStatements(asset: FaceAsset | FaceAssetInput): string
export function applyFaceAssetToSource(source: string, asset: FaceAsset | FaceAssetInput): string
