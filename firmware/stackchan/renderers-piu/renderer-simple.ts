import { createSimpleFaceContainer } from 'behaviors/face'
import { Face, type FaceEffect } from './renderer-base'

export type { FaceEffect }

export function createRenderer(): Face {
  return new Face({ face: createSimpleFaceContainer() })
}

// Compatibility: keep class name while delegating to Face constructor
export class Renderer extends Face {
  constructor() {
    super({ face: createSimpleFaceContainer() })
  }
}
