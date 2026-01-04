import {
  Container,
  Skin,
  type Container as PiuContainer,
  type Content as PiuContent,
  type Skin as PiuSkin,
} from 'piu/MC'
import { defaultFaceContext, type FaceContext } from 'face-context'
import { CommonView, CommonViewBehavior, type CommonViewParams, type CommonViewTemplateCtor } from 'common-view'
import type { FaceContainerParams, FaceTemplateCtor } from 'behaviors/face'

export type FaceViewParams = CommonViewParams & {
  face?: PiuContainer
  faceTemplate?: FaceTemplateCtor
  faceParams?: FaceContainerParams
  effects?: PiuContainer
  effectsTemplate?: { new (behaviorData?: unknown, dictionary?: unknown): PiuContainer }
  effectsParams?: unknown
  skin?: PiuSkin
}

export type FaceViewTemplateCtor = {
  new (behaviorData?: unknown, dictionary?: FaceViewParams): PiuContainer
}

class FaceViewBehavior extends CommonViewBehavior {
  face: PiuContainer | null = null
  effects: PiuContainer | null = null
  effectsSet = new Set<PiuContent>()
  autoTheme = true
  lastSecondary: string | null = null

  onCreate(container: PiuContainer, data: FaceViewParams) {
    super.onCreate(container, data)
    const main = this.main
    if (main) {
      this.face = main.first as PiuContainer | null
      this.effects = (this.face?.next as PiuContainer | null) ?? null
    }
    this.autoTheme = data.skin === undefined
  }

  onFaceUpdate(_container: PiuContainer, faceContext: Readonly<FaceContext>) {
    this.applyTheme(faceContext)
    const face = this.face
    const behavior = face?.behavior as
      | { onFaceUpdate?: (container: PiuContainer, face: FaceContext) => void }
      | undefined
    behavior?.onFaceUpdate?.(face as PiuContainer, faceContext as FaceContext)
  }

  onFaceContext(_container: PiuContainer, faceContext: FaceContext) {
    this.effects?.distribute('onFaceContext', faceContext)
    this.overlay?.distribute('onFaceContext', faceContext)
    this.appBar?.distribute?.('onFaceContext', faceContext)
    return true
  }

  addEffect(effect: PiuContent): void {
    if (!this.effects || this.effectsSet.has(effect)) return
    this.effectsSet.add(effect)
    this.effects.add(effect)
  }

  removeEffect(effect: PiuContent): void {
    if (!this.effects || !this.effectsSet.has(effect)) return
    this.effectsSet.delete(effect)
    effect.stop?.()
    this.effects.remove(effect)
  }

  setFaceContainer(face: PiuContainer): void {
    if (!this.main || this.face === face) return
    const currentFace = this.face
    this.face = face
    if (currentFace) this.main.remove(currentFace)
    if (this.effects) this.main.insert(this.face, this.effects)
    else this.main.add(this.face)
  }

  setFaceTemplate(template: FaceTemplateCtor, params?: FaceContainerParams): void {
    const next = new template(params)
    this.setFaceContainer(next)
  }

  private applyTheme(faceContext: Readonly<FaceContext>) {
    if (!this.autoTheme || !this.main) return
    const secondary = faceContext.theme.secondary
    if (secondary === this.lastSecondary) return
    this.lastSecondary = secondary
    this.main.skin = new Skin({ fill: secondary })
  }
}

export const FaceMainTemplate = Container.template(($) => {
  const face = $.face ?? ($.faceTemplate ? new $.faceTemplate($.faceParams) : new Container(null, {}))
  const effects =
    $.effects ??
    ($.effectsTemplate
      ? new $.effectsTemplate($.effectsParams)
      : new Container(null, { left: 0, right: 0, top: 0, bottom: 0, active: false, clip: false }))
  const skin = $.skin ?? new Skin({ fill: defaultFaceContext.theme.secondary })
  return {
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    skin,
    contents: [face, effects],
  }
}) as unknown as { new (behaviorData?: unknown, dictionary?: FaceViewParams): PiuContainer }

const CommonViewTemplate = CommonView as unknown as CommonViewTemplateCtor
export const FaceView = CommonViewTemplate.template?.(($) => ({
  Behavior: FaceViewBehavior,
})) as unknown as FaceViewTemplateCtor

export type { FaceViewBehavior }
