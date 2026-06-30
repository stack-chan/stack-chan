import {
  CommonView,
  CommonViewBehavior,
  type CommonViewParams,
  type CommonViewTemplateCtor,
  type TemplateFunction,
} from 'common-view'
import { type FaceSkinPalette, updateFaceSkinPalette } from 'face-skin'
import {
  copyFaceState,
  createFaceState,
  DEFAULT_FACE_SECONDARY_COLOR,
  type FaceState,
  toPiuColorString,
} from 'face-state'
import {
  Container,
  Die,
  type Container as PiuContainer,
  type Content as PiuContent,
  type Skin as PiuSkin,
  Skin,
} from 'piu/MC'

type FaceViewAnchors = {
  FACE?: PiuContainer
  EFFECTS?: PiuContainer
  FACE_REGION?: DieRegion
}

type FaceViewBaseParams = CommonViewParams
type DieRegion = PiuContainer & { set: (x: number, y: number, w: number, h: number) => DieRegion; cut: () => void }
type FaceContainerBehavior = {
  onFaceUpdate?: (container: PiuContainer, face: FaceState) => void
  rehydrate?: (container: PiuContainer, face: FaceState, palette?: FaceSkinPalette | null) => void
  getBaseCoordinates?: (container: PiuContainer) => { left: number; top: number }
}

export type FaceViewParams = FaceViewBaseParams &
  FaceViewAnchors & {
    face?: PiuContainer
    effects?: PiuContainer
    skin?: PiuSkin
  }

export type FaceViewTemplateCtor = TemplateFunction<FaceViewParams, PiuContainer>

class FaceViewBehavior extends CommonViewBehavior {
  face: PiuContainer | null = null
  faceRegion: DieRegion | null = null
  effects: PiuContainer | null = null
  effectsSet: Set<PiuContent> | null = null
  effectsByKey: Map<string, PiuContent> | null = null
  effectKeys: Map<PiuContent, string> | null = null
  autoTheme = true
  lastPalette: FaceSkinPalette | null = null
  lastFaceState: FaceState | null = null

  onCreate(container: PiuContainer, data: FaceViewParams) {
    super.onCreate(container, data)
    const main = this.main
    if (!main) {
      throw new Error('[FaceView] missing MAIN container')
    }
    if (!data.FACE || !data.EFFECTS || !data.FACE_REGION) {
      const missing: string[] = []
      if (!data.FACE) missing.push('FACE')
      if (!data.FACE_REGION) missing.push('FACE_REGION')
      if (!data.EFFECTS) missing.push('EFFECTS')
      throw new Error(`[FaceView] missing anchors: ${missing.join(', ')}`)
    }
    this.face = data.FACE
    this.faceRegion = data.FACE_REGION
    this.effects = data.EFFECTS
    this.effectsSet = new Set()
    this.effectsByKey = new Map()
    this.effectKeys = new Map()
    this.autoTheme = data.skin === undefined
  }

  onFaceUpdate(_container: PiuContainer, faceState: FaceState) {
    if (this.lastFaceState === null) {
      this.lastFaceState = createFaceState()
    }
    copyFaceState(faceState, this.lastFaceState)
    const palette = updateFaceSkinPalette(this.lastPalette, faceState)
    if (palette !== this.lastPalette) {
      this.onFaceSkin(_container, palette)
    }
    const face = this.face
    const behavior = face?.behavior as FaceContainerBehavior | undefined
    behavior?.onFaceUpdate?.(face as PiuContainer, faceState as FaceState)
    this.onFaceState?.(_container, faceState as FaceState)
  }

  onFaceSkin(_container: PiuContainer, palette: FaceSkinPalette) {
    this.lastPalette = palette
    if (this.autoTheme && this.main) {
      this.main.skin = palette.secondary
    }
    this.face?.distribute?.('onFaceSkin', palette)
    if (this.face) {
      this.rehydrateFace(this.face, this.lastFaceState ?? createFaceState(), palette)
    }
    this.effects?.distribute('onFaceSkin', palette)
    this.overlay?.distribute('onFaceSkin', palette)
    this.appBar?.distribute?.('onFaceSkin', palette)
    return true
  }

  onFaceState(_container: PiuContainer, faceState: FaceState) {
    this.effects?.distribute('onFaceState', faceState)
    this.overlay?.distribute('onFaceState', faceState)
    this.appBar?.distribute?.('onFaceState', faceState)
    return true
  }

  addEffect(effect: PiuContent, key?: string): void {
    if (!this.effects) return
    const effectsSet = this.getEffectsSet()
    const effectsByKey = this.getEffectsByKey()
    const effectKeys = this.getEffectKeys()
    const resolvedKey = key ?? (effect as PiuContent & { name?: string }).name
    if (resolvedKey) {
      const existing = effectsByKey.get(resolvedKey)
      if (existing && existing !== effect) {
        this.removeEffect(existing)
      }
      effectsByKey.set(resolvedKey, effect)
      effectKeys.set(effect, resolvedKey)
    }
    if (effectsSet.has(effect)) return
    effectsSet.add(effect)
    this.effects.add(effect)
  }

  removeEffect(effect: PiuContent): void {
    const effectsSet = this.getEffectsSet()
    if (!this.effects || !effectsSet.has(effect)) return
    const effectsByKey = this.getEffectsByKey()
    const effectKeys = this.getEffectKeys()
    effectsSet.delete(effect)
    effect.stop?.()
    this.effects.remove(effect)
    const key = effectKeys.get(effect)
    if (key) {
      effectKeys.delete(effect)
      if (effectsByKey.get(key) === effect) {
        effectsByKey.delete(key)
      }
    }
  }

  removeEffectByKey(key: string): void {
    const effect = this.getEffectsByKey().get(key)
    if (effect) {
      this.removeEffect(effect)
    }
  }

  rehydrateFace(face: PiuContainer, faceState: FaceState, palette = this.lastPalette): void {
    const behavior = face.behavior as FaceContainerBehavior | undefined
    if (behavior?.rehydrate) {
      behavior.rehydrate(face, faceState, palette)
      return
    }
    behavior?.onFaceUpdate?.(face, faceState as FaceState)
  }

  applyFaceState(face: PiuContainer): void {
    const faceState = this.lastFaceState ?? createFaceState()
    if (this.lastPalette) {
      face.distribute?.('onFaceSkin', this.lastPalette)
    }
    face.distribute?.('onFaceState', faceState)
    this.rehydrateFace(face, faceState, this.lastPalette)
  }

  setFace(face: PiuContainer): void {
    if (!face || this.face === face) return
    const currentFace = this.face
    const currentBehavior = currentFace?.behavior as FaceContainerBehavior | undefined
    const currentParent = currentFace
      ? (((currentFace as PiuContent & { container?: PiuContainer }).container ??
          this.faceRegion) as PiuContainer | null)
      : null
    const currentCoordinates =
      currentFace && currentBehavior?.getBaseCoordinates
        ? currentBehavior.getBaseCoordinates(currentFace)
        : currentFace?.coordinates
          ? { ...currentFace.coordinates }
          : null
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
      this.applyFaceState(face)
      return
    }

    if (this.faceRegion) {
      this.faceRegion.add(face)
      this.applyFaceState(face)
      return
    }

    if (!this.main) return
    if (this.effects) this.main.insert(face, this.effects)
    else this.main.add(face)
    this.applyFaceState(face)
  }

  private getEffectsSet(): Set<PiuContent> {
    if (!this.effectsSet) this.effectsSet = new Set()
    return this.effectsSet
  }

  private getEffectsByKey(): Map<string, PiuContent> {
    if (!this.effectsByKey) this.effectsByKey = new Map()
    return this.effectsByKey
  }

  private getEffectKeys(): Map<PiuContent, string> {
    if (!this.effectKeys) this.effectKeys = new Map()
    return this.effectKeys
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

    const faceRegion = new Die($, {
      anchor: 'FACE_REGION',
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
    }) as DieRegion

    if (!$.FACE_REGION) {
      $.FACE_REGION = faceRegion
    }
    faceRegion.add(face)
    const effects =
      $.effects ??
      new Container($, { left: 0, right: 0, top: 0, bottom: 0, active: false, clip: false, anchor: 'EFFECTS' })
    if (!$.EFFECTS) {
      $.EFFECTS = effects
    }
    const skin = $.skin ?? new Skin({ fill: toPiuColorString(DEFAULT_FACE_SECONDARY_COLOR) })
    return {
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
      skin,
      contents: [faceRegion, effects],
    }
  },
) as unknown as TemplateFunction<FaceViewParams, PiuContainer>

const CommonViewTemplate: CommonViewTemplateCtor = CommonView
export const FaceView: FaceViewTemplateCtor = CommonViewTemplate.template
  ? (CommonViewTemplate.template(($: FaceViewParams) => {
      if (!$.main && !$.MAIN) {
        if (!$.face) throw new Error('[FaceView] face is required when main is not provided')
        const main = new FaceMainTemplate($, { anchor: 'MAIN' })
        $.main = main
      }
      return { Behavior: FaceViewBehavior }
    }) as unknown as FaceViewTemplateCtor)
  : (CommonViewTemplate as FaceViewTemplateCtor)

export type { FaceViewBehavior }
