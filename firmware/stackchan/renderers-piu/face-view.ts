import {
  Container,
  Die,
  Skin,
  type Container as PiuContainer,
  type Content as PiuContent,
  type Skin as PiuSkin,
} from 'piu/MC'
import { defaultFaceContext, type FaceContext } from 'face-context'
import type { FaceSkinPalette } from 'face-skin'
import {
  CommonView,
  CommonViewBehavior,
  type CommonViewParams,
  type CommonViewTemplateCtor,
  type TemplateFunction,
} from 'common-view'

type FaceViewAnchors = {
  FACE?: PiuContainer
  EFFECTS?: PiuContainer
}

type FaceViewBaseParams = CommonViewParams
type DieRegion = PiuContainer & { set: (x: number, y: number, w: number, h: number) => DieRegion; cut: () => void }

export type FaceViewParams = FaceViewBaseParams &
  FaceViewAnchors & {
    face?: PiuContainer
    effects?: PiuContainer
    skin?: PiuSkin
  }

export type FaceViewTemplateCtor = TemplateFunction<FaceViewParams, PiuContainer>

class FaceViewBehavior extends CommonViewBehavior {
  face: PiuContainer | null = null
  effects: PiuContainer | null = null
  effectsSet = new Set<PiuContent>()
  effectsByKey = new Map<string, PiuContent>()
  effectKeys = new Map<PiuContent, string>()
  autoTheme = true
  lastPalette: FaceSkinPalette | null = null

  onCreate(container: PiuContainer, data: FaceViewParams) {
    super.onCreate(container, data)
    const main = this.main
    if (!main) {
      throw new Error('[FaceView] missing MAIN container')
    }
    if (!data.FACE || !data.EFFECTS) {
      const missing: string[] = []
      if (!data.FACE) missing.push('FACE')
      if (!data.EFFECTS) missing.push('EFFECTS')
      throw new Error(`[FaceView] missing anchors: ${missing.join(', ')}`)
    }
    this.face = data.FACE
    this.effects = data.EFFECTS
    this.autoTheme = data.skin === undefined
  }

  onFaceUpdate(_container: PiuContainer, faceContext: Readonly<FaceContext>) {
    const face = this.face
    const behavior = face?.behavior as
      | { onFaceUpdate?: (container: PiuContainer, face: FaceContext) => void }
      | undefined
    behavior?.onFaceUpdate?.(face as PiuContainer, faceContext as FaceContext)
    this.onFaceContext?.(_container, faceContext as FaceContext)
  }

  onFaceSkin(_container: PiuContainer, palette: FaceSkinPalette) {
    this.lastPalette = palette
    if (this.autoTheme && this.main) {
      this.main.skin = palette.secondary
    }
    this.effects?.distribute('onFaceSkin', palette)
    this.overlay?.distribute('onFaceSkin', palette)
    this.appBar?.distribute?.('onFaceSkin', palette)
    return true
  }

  onFaceContext(_container: PiuContainer, faceContext: FaceContext) {
    this.effects?.distribute('onFaceContext', faceContext)
    this.overlay?.distribute('onFaceContext', faceContext)
    this.appBar?.distribute?.('onFaceContext', faceContext)
    return true
  }

  addEffect(effect: PiuContent, key?: string): void {
    if (!this.effects) return
    const resolvedKey = key ?? (effect as PiuContent & { name?: string }).name
    if (resolvedKey) {
      const existing = this.effectsByKey.get(resolvedKey)
      if (existing && existing !== effect) {
        this.removeEffect(existing)
      }
      this.effectsByKey.set(resolvedKey, effect)
      this.effectKeys.set(effect, resolvedKey)
    }
    if (this.effectsSet.has(effect)) return
    this.effectsSet.add(effect)
    this.effects.add(effect)
  }

  removeEffect(effect: PiuContent): void {
    if (!this.effects || !this.effectsSet.has(effect)) return
    this.effectsSet.delete(effect)
    effect.stop?.()
    this.effects.remove(effect)
    const key = this.effectKeys.get(effect)
    if (key) {
      this.effectKeys.delete(effect)
      if (this.effectsByKey.get(key) === effect) {
        this.effectsByKey.delete(key)
      }
    }
  }

  removeEffectByKey(key: string): void {
    const effect = this.effectsByKey.get(key)
    if (effect) {
      this.removeEffect(effect)
    }
  }

  setFace(face: PiuContainer): void {
    if (!face || this.face === face) return
    const currentFace = this.face
    const currentParent = currentFace
      ? ((currentFace as PiuContent & { container?: PiuContainer }).container ?? null)
      : null
    const currentCoordinates = currentFace?.coordinates ? { ...currentFace.coordinates } : null
    this.face = face
    if (currentCoordinates) {
      face.coordinates = { ...(face.coordinates ?? {}), ...currentCoordinates }
    }

    if (currentFace && currentParent) {
      currentParent.remove(currentFace)
      if (currentParent === this.main && this.effects) {
        currentParent.insert(face, this.effects)
      } else {
        currentParent.add(face)
      }
      return
    }

    if (!this.main) return
    if (this.effects) this.main.insert(face, this.effects)
    else this.main.add(face)
  }
}

export const FaceMainTemplate: TemplateFunction<FaceViewParams, PiuContainer> = Container.template(
  ($: FaceViewParams) => {
    const face = $.face
    if (!face) throw new Error('[FaceMainTemplate] face instance is required')
    if (!$.FACE) {
      $.FACE = face
    }
    const faceBehavior = face.behavior as { breathPixels?: number } | undefined
    const breathPad = Math.max(0, Math.round(faceBehavior?.breathPixels ?? 0))
    const faceCoords = face.coordinates ?? {}
    const faceWidth = face.width ?? face.bounds?.width ?? 0
    const faceHeight = face.height ?? face.bounds?.height ?? 0
    const faceLeft = faceCoords.left ?? (face as PiuContent & { left?: number }).left ?? 0
    const faceTop = faceCoords.top ?? (face as PiuContent & { top?: number }).top ?? 0

    face.coordinates = {
      left: breathPad,
      top: breathPad,
    }

    const faceRegion = new Die(null, {
      left: faceLeft - breathPad,
      top: faceTop - breathPad,
      width: faceWidth + breathPad * 2,
      height: faceHeight + breathPad * 2,
      clip: true,
      Behavior: class extends Behavior {
        onDisplaying(die: DieRegion) {
          die.set(0, 0, die.width, die.height).cut()
        }
      },
    })

    faceRegion.add(face)
    const effects =
      $.effects ??
      new Container($, { left: 0, right: 0, top: 0, bottom: 0, active: false, clip: false, anchor: 'EFFECTS' })
    if (!$.EFFECTS) {
      $.EFFECTS = effects
    }
    const skin = $.skin ?? new Skin({ fill: defaultFaceContext.theme.secondary })
    return {
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
      skin,
      contents: [faceRegion, effects],
    }
  },
)

const CommonViewTemplate: CommonViewTemplateCtor = CommonView
export const FaceView: FaceViewTemplateCtor = CommonViewTemplate.template
  ? CommonViewTemplate.template(($: FaceViewParams) => {
      if (!$.main && !$.MAIN) {
        if (!$.face) throw new Error('[FaceView] face is required when main is not provided')
        const main = new FaceMainTemplate($, { anchor: 'MAIN' })
        $.main = main
      }
      return { Behavior: FaceViewBehavior }
    })
  : CommonViewTemplate

export type { FaceViewBehavior }
