import type { Skin as PiuSkin } from 'piu/MC'

type SkinCache = {
  solid: Record<string, PiuSkin>
  stroke: Record<string, PiuSkin>
  fillStroke: Record<string, PiuSkin>
}

function createSkinCache(): SkinCache {
  return {
    solid: Object.create(null) as Record<string, PiuSkin>,
    stroke: Object.create(null) as Record<string, PiuSkin>,
    fillStroke: Object.create(null) as Record<string, PiuSkin>,
  }
}

const cacheHolder = globalThis as { __stackchanSkinCache?: SkinCache }
let cache = cacheHolder.__stackchanSkinCache
if (!cache) {
  cache = createSkinCache()
  cacheHolder.__stackchanSkinCache = cache
}

export function getSolidSkin(color: string): PiuSkin {
  const cached = cache.solid[color]
  if (cached) return cached
  const skin = new Skin({ fill: color })
  cache.solid[color] = skin
  return skin
}

export function getStrokeSkin(color: string): PiuSkin {
  const cached = cache.stroke[color]
  if (cached) return cached
  const skin = new Skin({ stroke: color })
  cache.stroke[color] = skin
  return skin
}

export function getFillStrokeSkin(fill: string, stroke: string): PiuSkin {
  const key = `${fill}|${stroke}`
  const cached = cache.fillStroke[key]
  if (cached) return cached
  const skin = new Skin({ fill, stroke })
  cache.fillStroke[key] = skin
  return skin
}
