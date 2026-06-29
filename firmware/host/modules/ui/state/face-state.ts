export const Emotion = Object.freeze({
  NEUTRAL: 0,
  ANGRY: 1,
  SAD: 2,
  HAPPY: 3,
  SLEEPY: 4,
  DOUBTFUL: 5,
  COLD: 6,
  HOT: 7,
} as const)

export type Emotion = (typeof Emotion)[keyof typeof Emotion]

const emotionNames = Object.freeze(['NEUTRAL', 'ANGRY', 'SAD', 'HAPPY', 'SLEEPY', 'DOUBTFUL', 'COLD', 'HOT'] as const)
export type EmotionName = (typeof emotionNames)[number]
export const EmotionNames: readonly EmotionName[] = emotionNames

const EmotionByName: Record<string, Emotion> = Object.freeze({
  NEUTRAL: Emotion.NEUTRAL,
  ANGRY: Emotion.ANGRY,
  SAD: Emotion.SAD,
  HAPPY: Emotion.HAPPY,
  SLEEPY: Emotion.SLEEPY,
  DOUBTFUL: Emotion.DOUBTFUL,
  COLD: Emotion.COLD,
  HOT: Emotion.HOT,
})

const HEX_DIGITS = '0123456789abcdef'
export const DEFAULT_FACE_PRIMARY_COLOR = 0xffffff
export const DEFAULT_FACE_SECONDARY_COLOR = 0x000000

function clampByte(value: number): number {
  if (!Number.isFinite(value)) return 0
  if (value < 0) return 0
  if (value > 255) return 255
  return value | 0
}

function toHexByte(value: number): string {
  const clamped = clampByte(value)
  return `${HEX_DIGITS[(clamped >> 4) & 0x0f]}${HEX_DIGITS[clamped & 0x0f]}`
}

class BinaryView {
  readonly #view: DataView

  constructor(data: ArrayBufferLike | undefined, offset: number, length: number) {
    this.#view = new DataView(data ?? new ArrayBuffer(offset + length), offset, length)
  }

  get buffer(): ArrayBufferLike {
    return this.#view.buffer
  }

  get byteOffset(): number {
    return this.#view.byteOffset
  }

  get byteLength(): number {
    return this.#view.byteLength
  }

  getUint8(byteOffset: number): number {
    return this.#view.getUint8(byteOffset)
  }

  setUint8(byteOffset: number, value: number): void {
    this.#view.setUint8(byteOffset, value)
  }

  getFloat32(byteOffset: number, littleEndian?: boolean): number {
    return this.#view.getFloat32(byteOffset, littleEndian)
  }

  setFloat32(byteOffset: number, value: number, littleEndian?: boolean): void {
    this.#view.setFloat32(byteOffset, value, littleEndian)
  }
}

export class ColorRGB extends BinaryView {
  static readonly BYTE_LENGTH = 4

  constructor(data?: ArrayBufferLike, offset = 0, length = ColorRGB.BYTE_LENGTH) {
    super(data ?? new ArrayBuffer(offset + length), offset, length)
  }

  get r(): number {
    return this.getUint8(0)
  }

  set r(value: number) {
    this.setUint8(0, clampByte(value))
  }

  get g(): number {
    return this.getUint8(1)
  }

  set g(value: number) {
    this.setUint8(1, clampByte(value))
  }

  get b(): number {
    return this.getUint8(2)
  }

  set b(value: number) {
    this.setUint8(2, clampByte(value))
  }

  get pad(): number {
    return this.getUint8(3)
  }

  set pad(value: number) {
    this.setUint8(3, clampByte(value))
  }
}

export class MouthState extends BinaryView {
  static readonly BYTE_LENGTH = 4

  constructor(data?: ArrayBufferLike, offset = 0, length = MouthState.BYTE_LENGTH) {
    super(data ?? new ArrayBuffer(offset + length), offset, length)
  }

  get open(): number {
    return this.getFloat32(0, true)
  }

  set open(value: number) {
    this.setFloat32(0, value, true)
  }
}

export class EyeState extends BinaryView {
  static readonly BYTE_LENGTH = 12

  constructor(data?: ArrayBufferLike, offset = 0, length = EyeState.BYTE_LENGTH) {
    super(data ?? new ArrayBuffer(offset + length), offset, length)
  }

  get open(): number {
    return this.getFloat32(0, true)
  }

  set open(value: number) {
    this.setFloat32(0, value, true)
  }

  get gazeX(): number {
    return this.getFloat32(4, true)
  }

  set gazeX(value: number) {
    this.setFloat32(4, value, true)
  }

  get gazeY(): number {
    return this.getFloat32(8, true)
  }

  set gazeY(value: number) {
    this.setFloat32(8, value, true)
  }
}

export class EyesState extends BinaryView {
  static readonly BYTE_LENGTH = 24

  constructor(data?: ArrayBufferLike, offset = 0, length = EyesState.BYTE_LENGTH) {
    super(data ?? new ArrayBuffer(offset + length), offset, length)
  }

  get left(): EyeState {
    return new EyeState(this.buffer, this.byteOffset)
  }

  set left(value: EyeState) {
    copyBytes(value, new EyeState(this.buffer, this.byteOffset))
  }

  get right(): EyeState {
    return new EyeState(this.buffer, this.byteOffset + EyeState.BYTE_LENGTH)
  }

  set right(value: EyeState) {
    copyBytes(value, new EyeState(this.buffer, this.byteOffset + EyeState.BYTE_LENGTH))
  }
}

export class ThemeState extends BinaryView {
  static readonly BYTE_LENGTH = 8

  constructor(data?: ArrayBufferLike, offset = 0, length = ThemeState.BYTE_LENGTH) {
    super(data ?? new ArrayBuffer(offset + length), offset, length)
  }

  get primary(): ColorRGB {
    return new ColorRGB(this.buffer, this.byteOffset)
  }

  set primary(value: ColorRGB) {
    copyColorRGB(value, new ColorRGB(this.buffer, this.byteOffset))
  }

  get secondary(): ColorRGB {
    return new ColorRGB(this.buffer, this.byteOffset + ColorRGB.BYTE_LENGTH)
  }

  set secondary(value: ColorRGB) {
    copyColorRGB(value, new ColorRGB(this.buffer, this.byteOffset + ColorRGB.BYTE_LENGTH))
  }
}

/**
 * View-backed face state shared by the app runtime context and Piu UI.
 */
export class FaceState extends BinaryView {
  static readonly BYTE_LENGTH = 44

  constructor(data?: ArrayBufferLike, offset = 0, length = FaceState.BYTE_LENGTH) {
    super(data ?? new ArrayBuffer(offset + length), offset, length)
  }

  get mouth(): MouthState {
    return new MouthState(this.buffer, this.byteOffset)
  }

  set mouth(value: MouthState) {
    copyBytes(value, new MouthState(this.buffer, this.byteOffset))
  }

  get eyes(): EyesState {
    return new EyesState(this.buffer, this.byteOffset + MouthState.BYTE_LENGTH)
  }

  set eyes(value: EyesState) {
    copyBytes(value, new EyesState(this.buffer, this.byteOffset + MouthState.BYTE_LENGTH))
  }

  get breath(): number {
    return this.getFloat32(28, true)
  }

  set breath(value: number) {
    this.setFloat32(28, value, true)
  }

  get emotion(): Emotion {
    return this.getUint8(32) as Emotion
  }

  set emotion(value: Emotion) {
    this.setUint8(32, value)
  }

  get pad0(): number {
    return this.getUint8(33)
  }

  set pad0(value: number) {
    this.setUint8(33, clampByte(value))
  }

  get pad1(): number {
    return this.getUint8(34)
  }

  set pad1(value: number) {
    this.setUint8(34, clampByte(value))
  }

  get pad2(): number {
    return this.getUint8(35)
  }

  set pad2(value: number) {
    this.setUint8(35, clampByte(value))
  }

  get theme(): ThemeState {
    return new ThemeState(this.buffer, this.byteOffset + 36)
  }

  set theme(value: ThemeState) {
    copyBytes(value, new ThemeState(this.buffer, this.byteOffset + 36))
  }
}

export type FaceThemeKey = 'primary' | 'secondary'
export type FaceEyeKey = 'left' | 'right'

export function createFaceState(): FaceState {
  const state = new FaceState()
  resetFaceState(state)
  return state
}

export function resetFaceState(state: FaceState): void {
  state.mouth.open = 0
  state.eyes.left.open = 1
  state.eyes.left.gazeX = 0
  state.eyes.left.gazeY = 0
  state.eyes.right.open = 1
  state.eyes.right.gazeX = 0
  state.eyes.right.gazeY = 0
  state.breath = 1
  state.emotion = Emotion.NEUTRAL
  state.pad0 = 0
  state.pad1 = 0
  state.pad2 = 0
  setColorRGB(state.theme.primary, 0xff, 0xff, 0xff)
  setColorRGB(state.theme.secondary, 0x00, 0x00, 0x00)
}

export function copyFaceState(src: FaceState, dst: FaceState): void {
  copyBytes(src, dst)
}

export function copyColorRGB(src: ColorRGB, dst: ColorRGB): void {
  setColorRGB(dst, src.r, src.g, src.b)
  dst.pad = src.pad
}

export function setColorRGB(color: ColorRGB, r: number, g: number, b: number): void {
  color.r = r
  color.g = g
  color.b = b
  color.pad = 0
}

export function colorEquals(left: ColorRGB, right: ColorRGB): boolean {
  return left.r === right.r && left.g === right.g && left.b === right.b
}

export function toPiuColorNumber(color: ColorRGB): number {
  return (color.r << 16) | (color.g << 8) | color.b
}

export function toColorString(color: ColorRGB): string {
  return `#${toHexByte(color.r)}${toHexByte(color.g)}${toHexByte(color.b)}`
}

export function parseColorString(value: string): ColorRGB | undefined {
  const match = /^#?([0-9a-fA-F]{6})$/.exec(value)
  if (!match) return undefined
  const color = new ColorRGB()
  setColorRGB(
    color,
    Number.parseInt(match[1].slice(0, 2), 16),
    Number.parseInt(match[1].slice(2, 4), 16),
    Number.parseInt(match[1].slice(4, 6), 16),
  )
  return color
}

export function toEmotionName(emotion: Emotion): EmotionName {
  return emotionNames[emotion] ?? 'NEUTRAL'
}

export function emotionFromName(value: string): Emotion | undefined {
  return EmotionByName[value.toUpperCase()]
}

function copyBytes(src: BinaryView, dst: BinaryView): void {
  new Uint8Array(dst.buffer, dst.byteOffset, dst.byteLength).set(
    new Uint8Array(src.buffer, src.byteOffset, dst.byteLength),
  )
}
