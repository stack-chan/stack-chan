import type { Application as PiuApplication, Container as PiuContainer, Content as PiuContent } from 'piu/MC'
import { createFaceContainer } from 'behaviors/face'
import { toColorString, type FaceContext } from 'face-context'
import type { FaceDecorator } from 'renderer-simple'

type DecoratorWithBuild = FaceDecorator & { build?: (container: PiuContainer) => PiuContent }

export class Renderer {
  #application: PiuApplication
  #face: PiuContainer
  #decoratorContainer: PiuContainer
  #decorators: FaceDecorator[]
  #removingDecorators: FaceDecorator[]
  #lastSecondary?: string
  #decoratorNodes: Map<FaceDecorator, PiuContent>

  constructor() {
    this.#decorators = []
    this.#removingDecorators = []
    this.#face = createFaceContainer('dog', undefined, undefined, this.handleDecorators.bind(this))
    this.#decoratorContainer = new Container(null, {
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
      active: false,
      clip: false,
    })
    this.#application = new Application(null, {
      displayListLength: 8092,
      contents: [this.#face, this.#decoratorContainer],
      skin: new Skin({ fill: toColorString([0x00, 0x00, 0x00]) }),
    })
    this.#decoratorNodes = new Map()
  }

  update(_interval: number, faceContext: Readonly<FaceContext>): void {
    this.applyTheme(faceContext)
    type FaceBehaviorHandle = { onFaceUpdate?: (container: PiuContainer, face: FaceContext) => void }
    const behavior = this.#face.behavior as FaceBehaviorHandle | undefined
    behavior?.onFaceUpdate?.(this.#face, faceContext as FaceContext)
  }

  addDecorator(decorator: FaceDecorator): void {
    if (this.#decorators.includes(decorator)) return
    this.#decorators.push(decorator)
    const maybeBuilder = decorator as DecoratorWithBuild
    const node = maybeBuilder.build?.(this.#decoratorContainer) ?? new Content(null, { active: false, visible: false })
    this.#decoratorNodes.set(decorator, node)
    this.#decoratorContainer.add(node)
  }

  removeDecorator(decorator: FaceDecorator): void {
    const idx = this.#decorators.indexOf(decorator)
    if (idx !== -1) {
      this.#decorators.splice(idx, 1)
      this.#removingDecorators.push(decorator)
      const node = this.#decoratorNodes.get(decorator)
      if (node) {
        this.#decoratorContainer.remove(node)
        this.#decoratorNodes.delete(decorator)
      }
    }
  }

  private handleDecorators(tick: number, face: FaceContext) {
    for (const removing of this.#removingDecorators) removing(tick, face, true)
    for (const deco of this.#decorators) deco(tick, face)
    this.#removingDecorators.length = 0
  }

  private applyTheme(faceContext: Readonly<FaceContext>) {
    const secondary = toColorString(faceContext.theme.secondary)
    if (secondary === this.#lastSecondary) return
    this.#lastSecondary = secondary
    this.#application.skin = new Skin({ fill: secondary })
  }
}
