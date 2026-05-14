const BUTTON_NAMES = ['a', 'b', 'c']
const DEFAULT_CAMERA_WIDTH = 96
const DEFAULT_CAMERA_HEIGHT = 96
const DEFAULT_CAMERA_IMAGE_TYPE = 'rgb565le'

function normalizeDimension(value, fallback) {
  if (value === undefined) return fallback
  const normalized = value | 0
  return normalized > 0 ? normalized : fallback
}

function writeRgb565Le(view, width, height) {
  let offset = 0
  const widthScale = Math.max(1, width - 1)
  const heightScale = Math.max(1, height - 1)

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const red = (x * 31) / widthScale
      const green = ((x + y) * 63) / Math.max(1, width + height - 2)
      const blue = (y * 31) / heightScale
      const pixel = ((red & 0x1f) << 11) | ((green & 0x3f) << 5) | (blue & 0x1f)

      view[offset] = pixel & 0xff
      view[offset + 1] = (pixel >> 8) & 0xff
      offset += 2
    }
  }
}

export function createHostButtonBridge({ logger = console.log, setTimeoutFn = globalThis.setTimeout, resetDelayMs = 120 } = {}) {
  const states = Object.fromEntries(
    BUTTON_NAMES.map((name) => [name, { pressed: 1, firmwareCallbacks: new Set(), htmlAction: undefined }]),
  )

  const Button = Object.fromEntries(
    BUTTON_NAMES.map((name) => [
      name,
      class HtmlBridgeButton {
        constructor({ onPush } = {}) {
          if (onPush) states[name].firmwareCallbacks.add(onPush)
        }

        read() {
          return states[name].pressed
        }
      },
    ]),
  )

  return {
    Button,
    setHtmlAction(name, action) {
      if (!states[name]) return
      states[name].htmlAction = action
    },
    push(name) {
      const state = states[name]
      if (!state) return
      logger(`[bridge] Host.Button.${name} pushed`)
      state.pressed = 0
      for (const callback of state.firmwareCallbacks) callback()
      state.htmlAction?.()
      setTimeoutFn(() => {
        state.pressed = 1
      }, resetDelayMs)
    },
    read(name) {
      return states[name]?.pressed
    },
  }
}

export function createHostDriverBridge({ onRotation = () => {}, onTorque = () => {} } = {}) {
  let rotation = { y: 0, p: 0, r: 0 }
  let torque = true

  return {
    applyRotation(message = {}) {
      rotation = { ...rotation, ...(message.rotation ?? {}) }
      onRotation(rotation, message.time)
    },
    getRotation() {
      return rotation
    },
    setTorque(nextTorque) {
      torque = Boolean(nextTorque)
      onTorque(torque)
    },
    getTorque() {
      return torque
    },
  }
}

export function createHostCameraBridge() {
  let started = false

  return {
    start() {
      started = true
    },
    stop() {
      started = false
    },
    isStarted() {
      return started
    },
    capture(options = {}) {
      const imageType = options.imageType ?? DEFAULT_CAMERA_IMAGE_TYPE
      if (imageType !== 'rgb565le') return undefined

      const width = normalizeDimension(options.width, DEFAULT_CAMERA_WIDTH)
      const height = normalizeDimension(options.height, DEFAULT_CAMERA_HEIGHT)
      const buffer = new ArrayBuffer(width * height * 2)
      writeRgb565Le(new Uint8Array(buffer), width, height)

      return { width, height, imageType, buffer }
    },
  }
}

export function clientPointFromTouch(touch) {
  return { x: touch.clientX, y: touch.clientY }
}

export function summarizeImageData(imageData, { sampleLimit = 1024 } = {}) {
  const data = imageData?.data ?? imageData
  if (!data?.length) return { samples: 0, nonZeroAlpha: 0, nonZeroRgb: 0, firstPixel: [] }

  const pixels = Math.floor(data.length / 4)
  const stride = Math.max(1, Math.floor(pixels / sampleLimit))
  let samples = 0
  let nonZeroAlpha = 0
  let nonZeroRgb = 0
  for (let pixel = 0; pixel < pixels; pixel += stride) {
    const offset = pixel * 4
    samples++
    if (data[offset + 3] !== 0) nonZeroAlpha++
    if (data[offset] !== 0 || data[offset + 1] !== 0 || data[offset + 2] !== 0) nonZeroRgb++
  }

  return {
    samples,
    nonZeroAlpha,
    nonZeroRgb,
    firstPixel: Array.from(data.slice(0, 4)),
  }
}
