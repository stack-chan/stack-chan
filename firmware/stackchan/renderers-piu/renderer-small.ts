import { createSmallFaceContainer } from 'behaviors/face'
import { Face, type FaceEffect } from './renderer-base'

export type { FaceEffect }

export function createRenderer(): Face {
  return new Face({ face: createSmallFaceContainer() })
}

export class Renderer extends Face {
  constructor() {
    super({ face: createSmallFaceContainer() })
  }
}
