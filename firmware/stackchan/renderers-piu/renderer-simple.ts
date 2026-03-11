import { createSimpleFaceContainer } from 'behaviors/face'
import { Face, type FaceEffect } from './renderer-base'

export { FaceEffect }

export class Renderer extends Face {
  constructor() {
    super({ face: createSimpleFaceContainer() })
  }
}
