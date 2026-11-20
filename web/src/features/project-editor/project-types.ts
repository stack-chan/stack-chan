export type ProjectAsset = {
  path: string
  mediaType: string
  encoding: 'base64' | 'utf8'
  data: string
}

export type VisualProject = {
  format: string
  version: number
  id: string
  name: string
  target: string
  workspace: Record<string, unknown>
  assets: ProjectAsset[]
  settings: {
    educationalProfile: boolean
    embedAssets: boolean
    faceAsset: string | null
  }
  createdAt: string
  updatedAt: string
}

export type ProjectDiagnostic = {
  severity: 'warning' | 'error'
  code: string
  message: string
  blockId?: string | null
}

export type ProjectAnalysis = {
  requirements: string[]
  diagnostics: ProjectDiagnostic[]
  canBuild: boolean
}
