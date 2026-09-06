import type { AppContext } from 'stackchan/app'
import { StackchanError } from 'stackchan/errors'

export interface AppLighting {
  readonly names: readonly string[]
  color(name: string, color: { r: number; g: number; b: number }): void
  rainbow(name: string): void
  off(name: string): void
}

export function lighting(app: AppContext): AppLighting {
  const lights = (app as AppContext & { lighting?: AppLighting }).lighting
  if (!lights) throw new StackchanError('UNSUPPORTED', 'Lighting is unavailable')
  return lights
}
