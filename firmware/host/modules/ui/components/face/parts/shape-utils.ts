import { toPiuColorString } from 'face-state'
import { type Skin as PiuSkin, Skin } from 'piu/MC'

export const UNIT_OPEN_STEPS = 24
export const FULL_TURN = 2 * Math.PI

let fillSkinCache: Map<number, PiuSkin> | null = null
let strokeSkinCache: Map<number, PiuSkin> | null = null
let fillStrokeSkinCache: Map<number, PiuSkin> | null = null

export function quantizeUnit(value: number, steps = UNIT_OPEN_STEPS): number {
  if (!Number.isFinite(value)) return 0
  if (value <= 0) return 0
  if (value >= 1) return steps
  return Math.round(value * steps)
}

export function unitFromStep(step: number, steps = UNIT_OPEN_STEPS): number {
  if (step <= 0) return 0
  if (step >= steps) return 1
  return step / steps
}

export function getFillSkin(color: number): PiuSkin {
  if (!fillSkinCache) fillSkinCache = new Map()
  let skin = fillSkinCache.get(color)
  if (skin) return skin
  skin = new Skin({ fill: toPiuColorString(color) })
  fillSkinCache.set(color, skin)
  return skin
}

export function getStrokeSkin(color: number): PiuSkin {
  if (!strokeSkinCache) strokeSkinCache = new Map()
  let skin = strokeSkinCache.get(color)
  if (skin) return skin
  skin = new Skin({ stroke: toPiuColorString(color) })
  strokeSkinCache.set(color, skin)
  return skin
}

export function getFillStrokeSkin(color: number): PiuSkin {
  if (!fillStrokeSkinCache) fillStrokeSkinCache = new Map()
  let skin = fillStrokeSkinCache.get(color)
  if (skin) return skin
  const value = toPiuColorString(color)
  skin = new Skin({ fill: value, stroke: value })
  fillStrokeSkinCache.set(color, skin)
  return skin
}
