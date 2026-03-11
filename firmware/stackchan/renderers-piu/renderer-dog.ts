import { createDogFaceParts, createFaceContainer } from 'behaviors/face'
import { RendererBase, type FaceDecorator } from './renderer-base'

export { FaceDecorator }

export class Renderer extends RendererBase {
  constructor() {
    super(createFaceContainer(createDogFaceParts, undefined, undefined, 240))
  }
}
