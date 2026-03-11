import type {
  Application as PiuApplication,
  Container as PiuContainer,
  Content as PiuContent,
  Skin as PiuSkin,
} from 'piu/MC'
import { toColorString, type FaceContext } from 'face-context'

export type FaceEffect = PiuContent

export class Face {
  #application: PiuApplication
  #face: PiuContainer
  #effectContainer: PiuContainer
  #effects: Set<PiuContent>
  #lastSecondary?: string
  #autoTheme: boolean

  constructor(options: { face: PiuContainer; skin?: PiuSkin; displayListLength?: number }) {
    this.#effects = new Set()
    this.#face = options.face
    this.#effectContainer = new Container(null, {
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
      displayListLength: options.displayListLength ?? 2048,
      contents: [this.#face, this.#effectContainer],
      skin,
    })
  }

  update(_interval: number, faceContext: Readonly<FaceContext>): void {
    this.applyTheme(faceContext)
    type FaceBehaviorHandle = { onFaceUpdate?: (container: PiuContainer, face: FaceContext) => void }
    const behavior = this.#face.behavior as FaceBehaviorHandle | undefined
    behavior?.onFaceUpdate?.(this.#face, faceContext as FaceContext)
  }

  get application(): PiuApplication {
    return this.#application
  }

  get faceContainer(): PiuContainer {
    return this.#face
  }

  get effectContainer(): PiuContainer {
    return this.#effectContainer
  }

  addEffect(effect: PiuContent): void {
    if (this.#effects.has(effect)) return
    this.#effects.add(effect)
    this.#effectContainer.add(effect)
  }

  removeEffect(effect: PiuContent): void {
    if (!this.#effects.has(effect)) return
    this.#effects.delete(effect)
    this.#effectContainer.remove(effect)
  }

  private applyTheme(faceContext: Readonly<FaceContext>) {
    if (!this.#autoTheme) return
    const secondary = toColorString(faceContext.theme.secondary)
    if (secondary === this.#lastSecondary) return
    this.#lastSecondary = secondary
    this.#application.skin = new Skin({ fill: secondary })
  }
}
