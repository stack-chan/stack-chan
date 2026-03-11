import { createFaceContainer, createSmallFaceParts } from 'behaviors/face'
import { RendererBase, type FaceDecorator } from './renderer-base'

export { FaceDecorator }

export class Renderer extends RendererBase {
  constructor() {
    super(createFaceContainer(createSmallFaceParts, undefined, undefined, 120))
  }
}
