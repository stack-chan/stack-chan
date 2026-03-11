import { createFaceContainer, createSimpleFaceParts } from 'behaviors/face'
import { RendererBase, type FaceDecorator } from './renderer-base'

export { FaceDecorator }

export class Renderer extends RendererBase {
  constructor() {
    super(createFaceContainer(createSimpleFaceParts, undefined, undefined, 240))
  }
}
