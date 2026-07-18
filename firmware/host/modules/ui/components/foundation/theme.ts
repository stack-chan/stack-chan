import { getLocalizationLanguage } from 'localization'
import type { Skin as PiuSkin, Style as PiuStyle } from 'piu/MC'
import { Skin, Style } from 'piu/MC'

export const UI = Object.freeze({
  screenWidth: 320,
  screenHeight: 240,
  headerHeight: 40,
  touchTarget: 44,
  radius: 6,
  space: 8,
  colors: {
    background: '#101214',
    surface: '#202428',
    surfacePressed: '#30363c',
    border: '#4b535b',
    text: '#ffffff',
    textMuted: '#b8c0c8',
    accent: '#42bde8',
    success: '#42c878',
    warning: '#f0b44c',
    error: '#ef6262',
    disabled: '#60666c',
    scrim: '#00000099',
  },
})

type FoundationStyles = {
  screen: PiuSkin
  surface: PiuSkin
  pressed: PiuSkin
  disabled: PiuSkin
  accent: PiuSkin
  success: PiuSkin
  danger: PiuSkin
  brand: PiuStyle
  title: PiuStyle
  body: PiuStyle
  bodyMuted: PiuStyle
  button: PiuStyle
  compact: PiuStyle
}

let cached: FoundationStyles | null = null
let cachedFont = ''

export function uiFont(): string {
  return getLocalizationLanguage() === 'zh-CN' ? 'StackchanCJK-12' : 'k8x12-12'
}

export function uiStyles(): FoundationStyles {
  const font = uiFont()
  if (cached && cachedFont === font) return cached
  cachedFont = font
  cached = {
    screen: new Skin({ fill: UI.colors.background }),
    surface: new Skin({ fill: UI.colors.surface }),
    pressed: new Skin({ fill: UI.colors.surfacePressed }),
    disabled: new Skin({ fill: UI.colors.disabled }),
    accent: new Skin({ fill: UI.colors.accent }),
    success: new Skin({ fill: UI.colors.success }),
    danger: new Skin({ fill: UI.colors.error }),
    brand: new Style({
      font: 'k8x12-24',
      color: UI.colors.text,
      horizontal: 'center',
      vertical: 'middle',
    }),
    // These styles are semantically distinct so callers can evolve typography without changing view contracts.
    title: new Style({
      font,
      color: UI.colors.text,
      horizontal: 'left',
      vertical: 'middle',
    }),
    body: new Style({
      font,
      color: UI.colors.text,
      horizontal: 'left',
      vertical: 'middle',
    }),
    bodyMuted: new Style({
      font,
      color: UI.colors.textMuted,
      horizontal: 'left',
      vertical: 'middle',
    }),
    button: new Style({
      font,
      color: UI.colors.text,
      horizontal: 'center',
      vertical: 'middle',
    }),
    compact: new Style({
      font,
      color: UI.colors.text,
      horizontal: 'left',
      vertical: 'middle',
    }),
  }
  return cached
}
