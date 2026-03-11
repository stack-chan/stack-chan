import type {
  Application as PiuApplication,
  Container as PiuContainer,
  Content as PiuContent,
  Skin as PiuSkin,
} from 'piu/MC'
import { toColorString, type FaceContext } from 'face-context'

export type FaceDecorator = PiuContent

export class RendererBase {
  #application: PiuApplication
  #face: PiuContainer
  #decoratorContainer: PiuContainer
  #decorators: Set<PiuContent>
  #lastSecondary?: string
  #autoTheme: boolean

  constructor(options: { face: PiuContainer; skin?: PiuSkin; displayListLength?: number }) {
    this.#decorators = new Set()
    this.#face = options.face
    this.#decoratorContainer = new Container(null, {
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
      active: false,
      clip: false,
    })
    const skin = options.skin ?? new Skin({ fill: toColorString([0x00, 0x00, 0x00]) })
    this.#autoTheme = options.skin === undefined
    this.#application = new Application(null, {
      displayListLength: options.displayListLength ?? 8092,
      contents: [this.#face, this.#decoratorContainer],
      skin,
    })
  }

  update(_interval: number, faceContext: Readonly<FaceContext>): void {
    this.applyTheme(faceContext)
    type FaceBehaviorHandle = { onFaceUpdate?: (container: PiuContainer, face: FaceContext) => void }
    const behavior = this.#face.behavior as FaceBehaviorHandle | undefined
    behavior?.onFaceUpdate?.(this.#face, faceContext as FaceContext)
  }

  addDecorator(decorator: PiuContent): void {
    if (this.#decorators.has(decorator)) return
    this.#decorators.add(decorator)
    this.#decoratorContainer.add(decorator)
  }

  removeDecorator(decorator: PiuContent): void {
    if (!this.#decorators.has(decorator)) return
    this.#decorators.delete(decorator)
    this.#decoratorContainer.remove(decorator)
  }

  private applyTheme(faceContext: Readonly<FaceContext>) {
    if (!this.#autoTheme) return
    const secondary = toColorString(faceContext.theme.secondary)
    if (secondary === this.#lastSecondary) return
    this.#lastSecondary = secondary
    this.#application.skin = new Skin({ fill: secondary })
  }
}
