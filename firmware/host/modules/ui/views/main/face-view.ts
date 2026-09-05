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
  faceStatesEqual,
  toPiuColorString,
} from 'face-state'
import { type HandAnimationName, Hands } from 'hands'
import {
  Container,
  Die,
  type Container as PiuContainer,
  type Content as PiuContent,
  type Skin as PiuSkin,
  Skin,
} from 'piu/MC'

type FaceViewAnchors = {
  FACE?: FaceViewCustomFace
  EFFECTS?: PiuContainer
  FACE_REGION?: DieRegion
}

type FaceViewBaseParams = CommonViewParams
type DieRegion = PiuContainer & { set: (x: number, y: number, w: number, h: number) => DieRegion; cut: () => void }

export type FaceViewBaseCoordinates = { left: number; top: number }
export type FaceViewCustomFaceBehavior = {
  readonly breathPixels?: number
  /** False uses the incoming face coordinates instead of inheriting the outgoing origin. */
  readonly preservePositionOnSwap?: boolean
  onFaceUpdate?: (container: PiuContainer, face: FaceState) => void
  rehydrate?: (container: PiuContainer, face: FaceState, palette?: FaceSkinPalette | null) => void
  getBaseCoordinates?: (container: PiuContainer) => FaceViewBaseCoordinates
  setMotionsEnabled?: (container: PiuContainer, enabled: boolean) => void
}
export type FaceViewCustomFace = PiuContainer & { behavior?: FaceViewCustomFaceBehavior }

type FaceEffectBehavior = {
  onFaceSkin?: (content: PiuContent, palette: FaceSkinPalette) => void
  onFaceState?: (content: PiuContent, face: FaceState) => void
}

export type FaceViewParams = FaceViewBaseParams &
  FaceViewAnchors & {
    face?: FaceViewCustomFace
    effects?: PiuContainer
    skin?: PiuSkin
  }

export type FaceViewTemplateCtor = TemplateFunction<FaceViewParams, PiuContainer>

type PositionedFace = FaceViewCustomFace & {
  left?: number
  top?: number
  width?: number
  height?: number
  bounds?: { width?: number; height?: number }
  coordinates?: {
    left?: number
    top?: number
    width?: number
    height?: number
    right?: number
    bottom?: number
  }
}

type FaceLayout = {
  left: number
  top: number
  width: number
  height: number
  breathPad: number
}

function faceNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function faceBehavior(face: FaceViewCustomFace): FaceViewCustomFaceBehavior | undefined {
  return face.behavior as FaceViewCustomFaceBehavior | undefined
}

function measureFaceLayout(face: FaceViewCustomFace): FaceLayout {
  const positioned = face as PositionedFace
  const coordinates = positioned.coordinates ?? {}
  const breathPad = Math.max(0, Math.round(faceBehavior(face)?.breathPixels ?? 0))
  return {
    left: faceNumber(coordinates.left, faceNumber(positioned.left)),
    top: faceNumber(coordinates.top, faceNumber(positioned.top)),
    width: faceNumber(coordinates.width, faceNumber(positioned.width, faceNumber(positioned.bounds?.width))),
    height: faceNumber(coordinates.height, faceNumber(positioned.height, faceNumber(positioned.bounds?.height))),
    breathPad,
  }
}

function readFaceBaseCoordinates(face: FaceViewCustomFace): FaceViewBaseCoordinates {
  const positioned = face as PositionedFace
  const coordinates = positioned.coordinates ?? {}
  return {
    left: faceNumber(coordinates.left, faceNumber(positioned.left)),
    top: faceNumber(coordinates.top, faceNumber(positioned.top)),
  }
}

function setFaceBaseCoordinates(face: FaceViewCustomFace, left: number, top: number): void {
  const positioned = face as PositionedFace
  positioned.coordinates = {
    ...(positioned.coordinates ?? {}),
    left,
    top,
  }
}

function resizeFaceRegion(region: DieRegion, visualLeft: number, visualTop: number, layout: FaceLayout): void {
  const width = layout.width + layout.breathPad * 2
  const height = layout.height + layout.breathPad * 2
  const positioned = region as PositionedFace
  positioned.coordinates = {
    ...(positioned.coordinates ?? {}),
    left: visualLeft - layout.breathPad,
    top: visualTop - layout.breathPad,
    width,
    height,
  }
  region.set(0, 0, width, height).cut()
}

class FaceViewBehavior extends CommonViewBehavior {
  face: FaceViewCustomFace | null = null
  /** The face main component (FaceMainTemplate). Preserved across setMain swaps so the face can be restored. */
  faceMain: PiuContainer | null = null
  faceRegion: DieRegion | null = null
  effects: PiuContainer | null = null
  effectsSet: Set<PiuContent> | null = null
  effectsByKey: Map<string, PiuContent> | null = null
  effectKeys: Map<PiuContent, string> | null = null
  autoTheme = true
  lastPalette: FaceSkinPalette | null = null
  lastFaceState: FaceState | null = null
  faceMotionEnabled = true

  onCreate(container: PiuContainer, data: FaceViewParams) {
    super.onCreate(container, data)
    const main = this.main
    if (!main) {
      throw new Error('[FaceView] missing MAIN container')
    }
    this.faceMain = main
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
    // While a non-face main component is shown, pause face animation; showFace() resyncs on restore.
    if (this.faceMain && this.main !== this.faceMain) return
    if (this.lastFaceState === null) {
      this.lastFaceState = createFaceState()
    } else if (faceStatesEqual(faceState, this.lastFaceState)) {
      return
    }
    copyFaceState(faceState, this.lastFaceState)
    const palette = updateFaceSkinPalette(this.lastPalette, faceState)
    if (palette !== this.lastPalette) {
      this.onFaceSkin(_container, palette)
    }
    const face = this.face
    const behavior = face ? faceBehavior(face) : undefined
    behavior?.onFaceUpdate?.(face as PiuContainer, faceState as FaceState)
    this.onFaceState?.(_container, faceState as FaceState)
  }

  onFaceSkin(_container: PiuContainer, palette: FaceSkinPalette) {
    this.lastPalette = palette
    if (this.autoTheme && this.faceMain) {
      this.faceMain.skin = palette.secondary
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

  setHandAnimation(animation: HandAnimationName): void {
    this.effects?.distribute('onHandAnimationChanged', animation)
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
    this.applyEffectState(effect)
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

  rehydrateFace(face: FaceViewCustomFace, faceState: FaceState, palette = this.lastPalette): void {
    const behavior = faceBehavior(face)
    if (behavior?.rehydrate) {
      behavior.rehydrate(face, faceState, palette)
      return
    }
    behavior?.onFaceUpdate?.(face, faceState as FaceState)
  }

  applyFaceState(face: FaceViewCustomFace): void {
    const faceState = this.lastFaceState ?? createFaceState()
    if (this.lastPalette) {
      face.distribute?.('onFaceSkin', this.lastPalette)
    }
    face.distribute?.('onFaceState', faceState)
    this.rehydrateFace(face, faceState, this.lastPalette)
  }

  private applyEffectState(effect: PiuContent): void {
    const behavior = effect.behavior as FaceEffectBehavior | undefined
    if (this.lastPalette) {
      behavior?.onFaceSkin?.(effect, this.lastPalette)
    }
    behavior?.onFaceState?.(effect, this.lastFaceState ?? createFaceState())
  }

  setFace(face: FaceViewCustomFace): void {
    if (!face || this.face === face) return
    const currentFace = this.face
    const currentParent = currentFace
      ? (((currentFace as PiuContent & { container?: PiuContainer }).container ??
          this.faceRegion) as PiuContainer | null)
      : null
    const currentCoordinates =
      faceBehavior(face)?.preservePositionOnSwap === false
        ? readFaceBaseCoordinates(face)
        : currentFace
          ? this.getFaceVisualCoordinates(currentFace)
          : null
    this.face = face
    this.prepareFaceForRegion(face, currentCoordinates)
    faceBehavior(face)?.setMotionsEnabled?.(face, this.faceMotionEnabled)

    if (currentFace && currentParent) {
      currentParent.remove(currentFace)
      if (currentParent === this.faceMain && this.effects) {
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

    if (!this.faceMain) return
    if (this.effects) this.faceMain.insert(face, this.effects)
    else this.faceMain.add(face)
    this.applyFaceState(face)
  }

  setFaceMotionEnabled(enabled: boolean): void {
    if (this.faceMotionEnabled === enabled) return
    this.faceMotionEnabled = enabled
    const face = this.face
    if (face) faceBehavior(face)?.setMotionsEnabled?.(face, enabled)
  }

  /** Restore the face main component (e.g. after a dialog was shown via setMain) and resync its state. */
  showFace(): void {
    if (!this.faceMain || this.main === this.faceMain) return
    this.setMain(this.faceMain)
    if (this.face) this.applyFaceState(this.face)
  }

  private getFaceVisualCoordinates(face: FaceViewCustomFace): FaceViewBaseCoordinates {
    const behavior = faceBehavior(face)
    const base = behavior?.getBaseCoordinates ? behavior.getBaseCoordinates(face) : readFaceBaseCoordinates(face)
    if (!this.faceRegion) return base
    const region = this.faceRegion as PositionedFace
    const regionCoordinates = region.coordinates ?? {}
    return {
      left: faceNumber(regionCoordinates.left, faceNumber(region.left)) + base.left,
      top: faceNumber(regionCoordinates.top, faceNumber(region.top)) + base.top,
    }
  }

  private prepareFaceForRegion(face: FaceViewCustomFace, visualCoordinates: FaceViewBaseCoordinates | null): void {
    if (!this.faceRegion || !visualCoordinates) {
      if (visualCoordinates) setFaceBaseCoordinates(face, visualCoordinates.left, visualCoordinates.top)
      return
    }
    const layout = measureFaceLayout(face)
    setFaceBaseCoordinates(face, layout.breathPad, layout.breathPad)
    resizeFaceRegion(this.faceRegion, visualCoordinates.left, visualCoordinates.top, layout)
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
    const layout = measureFaceLayout(face)
    setFaceBaseCoordinates(face, layout.breathPad, layout.breathPad)

    const faceRegion = new Die($, {
      anchor: 'FACE_REGION',
      left: layout.left - layout.breathPad,
      top: layout.top - layout.breathPad,
      width: layout.width + layout.breathPad * 2,
      height: layout.height + layout.breathPad * 2,
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
    const hands = new Hands({})
    const effects =
      $.effects ??
      new Container($, {
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
        active: false,
        clip: false,
        anchor: 'EFFECTS',
        contents: [hands],
      })
    if ($.effects) {
      if (effects.first) effects.insert(hands, effects.first)
      else effects.add(hands)
    }
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
