import { validateModArchive } from './mod-storage.mjs'

const BUTTON_NAMES = ['a', 'b', 'c']
const MOD_INSTALL_HOOKS = ['_fxMainSetModArchive', '_wasmModInstallArchive']
const DEFAULT_CAMERA_WIDTH = 96
const DEFAULT_CAMERA_HEIGHT = 96
const DEFAULT_CAMERA_IMAGE_TYPE = 'rgb565le'
const HAVE_CURRENT_DATA = 2

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

export function createHostButtonBridge({
  logger = console.log,
  setTimeoutFn = globalThis.setTimeout,
  resetDelayMs = 120,
} = {}) {
  // Moddable's Button driver normalizes read() to 1 while pressed and 0 while
  // released, regardless of the physical pin's active-low wiring. Host.Button
  // must expose that normalized contract because SimButton passes read()
  // directly to StackchanRuntimeInput.
  const states = Object.fromEntries(BUTTON_NAMES.map((name) => [name, { pressed: 0, firmwareCallbacks: new Set() }]))

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
    ])
  )
  Object.defineProperty(Button, 'read', {
    value: (name) => states[name]?.pressed,
  })

  return {
    Button,
    push(name) {
      const state = states[name]
      if (!state) return
      logger(`[bridge] Host.Button.${name} pushed`)
      state.pressed = 1
      const currentGeneration = (state.generation = (state.generation ?? 0) + 1)
      for (const callback of state.firmwareCallbacks) callback()
      setTimeoutFn(() => {
        if (state.generation !== currentGeneration) return
        state.pressed = 0
        for (const callback of state.firmwareCallbacks) callback()
      }, resetDelayMs)
    },
    read(name) {
      return states[name]?.pressed
    },
  }
}

export function installModArchiveIntoWasm(wasmModule, installedMod) {
  if (!installedMod) return { status: 'empty' }

  const bytes = validateModArchive(installedMod.bytes)
  const size = bytes.byteLength
  const hookName = MOD_INSTALL_HOOKS.find((name) => typeof wasmModule?.[name] === 'function')

  if (typeof wasmModule?._malloc !== 'function' || !wasmModule.HEAPU8) {
    return { status: 'unsupported', name: installedMod.name, size }
  }

  const pointer = wasmModule._malloc(bytes.byteLength)
  if (!Number.isSafeInteger(pointer) || pointer <= 0) throw new Error('Could not allocate WASM MOD archive memory')
  try {
    wasmModule.HEAPU8.set(bytes, pointer)
  } catch (error) {
    wasmModule._free?.(pointer)
    throw error
  }

  if (!hookName) return { status: 'prepared', pointer, name: installedMod.name, size }

  try {
    const result = wasmModule[hookName](pointer, bytes.byteLength)
    return { status: 'installed', hook: hookName, name: installedMod.name, size, result }
  } finally {
    wasmModule._free?.(pointer)
  }
}

export { createHostAudioOutBridge } from './audio-output.mjs'

function writeImageDataRgb565Le(view, imageData) {
  let offset = 0
  const data = imageData.data

  for (let index = 0; index < data.length; index += 4) {
    const red = data[index] >> 3
    const green = data[index + 1] >> 2
    const blue = data[index + 2] >> 3
    const pixel = (red << 11) | (green << 5) | blue

    view[offset] = pixel & 0xff
    view[offset + 1] = (pixel >> 8) & 0xff
    offset += 2
  }
}

function createSyntheticCameraFrame(options = {}) {
  const imageType = options.imageType ?? DEFAULT_CAMERA_IMAGE_TYPE
  if (imageType !== 'rgb565le') return undefined

  const width = normalizeDimension(options.width, DEFAULT_CAMERA_WIDTH)
  const height = normalizeDimension(options.height, DEFAULT_CAMERA_HEIGHT)
  const buffer = new ArrayBuffer(width * height * 2)
  writeRgb565Le(new Uint8Array(buffer), width, height)

  return { width, height, imageType, buffer }
}

export function createHostCameraBridge({
  documentObj = globalThis.document,
  navigatorObj = globalThis.navigator,
  videoElement,
  canvasElement,
} = {}) {
  let started = false
  let useBrowserCamera = true
  let browserCameraStarted = false
  let stream
  let video = videoElement
  let canvas = canvasElement
  let generation = 0
  let pendingStart
  let cleanupFailure
  const failure = (code, message) => Object.assign(new Error(message), { code })
  const stopTracks = (owned) => {
    let firstError
    for (const track of owned?.getTracks?.() ?? []) {
      try {
        track.stop?.()
      } catch (error) {
        firstError ??= error
      }
    }
    if (firstError) {
      cleanupFailure ??= firstError
      throw cleanupFailure
    }
  }
  const stop = () => {
    generation++
    started = false
    browserCameraStarted = false
    pendingStart = undefined
    const owned = stream
    stream = undefined
    try {
      if (video) video.srcObject = null
    } catch (error) {
      cleanupFailure ??= error
    }
    stopTracks(owned)
    if (cleanupFailure) throw cleanupFailure
  }
  const dimension = (value, fallback, maximum) => {
    const result = value ?? fallback
    if (!Number.isInteger(result) || result < 1 || result > maximum)
      throw failure('INVALID_ARGUMENT', 'Invalid camera dimensions')
    return result
  }
  const bridge = {
    availability() {
      return !useBrowserCamera ? 'simulated' : navigatorObj?.mediaDevices?.getUserMedia ? 'native' : 'unavailable'
    },
    start(options = {}) {
      if (cleanupFailure) return Promise.reject(cleanupFailure)
      const browser = options.useBrowserCamera ?? useBrowserCamera
      if (started && browser === useBrowserCamera && (browserCameraStarted || !browser)) return Promise.resolve()
      if (pendingStart && browser === useBrowserCamera) return pendingStart
      stop()
      useBrowserCamera = browser
      started = true
      if (!browser) return Promise.resolve()
      const epoch = generation
      const getUserMedia = navigatorObj?.mediaDevices?.getUserMedia?.bind(navigatorObj.mediaDevices)
      const starting = Promise.resolve()
        .then(async () => {
          if (epoch !== generation) throw failure('CANCELLED', 'Camera start cancelled')
          if (!getUserMedia) throw failure('UNSUPPORTED', 'Browser camera is unavailable')
          video ??= documentObj?.createElement?.('video')
          if (!video) throw failure('UNSUPPORTED', 'Browser video is unavailable')
          video.muted = true
          video.playsInline = true
          const owned = await getUserMedia({ video: options.video ?? true })
          if (epoch !== generation) {
            stopTracks(owned)
            throw failure('CANCELLED', 'Camera start cancelled')
          }
          stream = owned
          video.srcObject = owned
          await video.play?.()
          if (epoch !== generation) throw failure('CANCELLED', 'Camera start cancelled')
          browserCameraStarted = true
        })
        .catch((error) => {
          if (epoch === generation) stop()
          throw error
        })
        .finally(() => {
          if (pendingStart === starting) pendingStart = undefined
        })
      pendingStart = starting
      return starting
    },
    stop,
    isStarted() {
      return started
    },
    isBrowserCameraStarted() {
      return browserCameraStarted
    },
    capture(options = {}) {
      if (!started) throw failure('CLOSED', 'Camera is stopped')
      const imageType = options.imageType ?? DEFAULT_CAMERA_IMAGE_TYPE
      if (imageType !== 'rgb565le') throw failure('UNSUPPORTED', 'Browser camera supports RGB565LE')
      const width = dimension(options.width, DEFAULT_CAMERA_WIDTH, 320)
      const height = dimension(options.height, DEFAULT_CAMERA_HEIGHT, 240)
      if (!useBrowserCamera) return { ...createSyntheticCameraFrame({ width, height, imageType }), source: 'simulated' }
      if (
        !browserCameraStarted ||
        !video ||
        video.readyState < HAVE_CURRENT_DATA ||
        !video.videoWidth ||
        !video.videoHeight
      )
        return undefined
      canvas ??= documentObj?.createElement?.('canvas')
      const context = canvas?.getContext?.('2d', { willReadFrequently: true })
      if (!context?.drawImage || !context?.getImageData)
        throw failure('UNSUPPORTED', 'Browser image capture is unavailable')
      canvas.width = width
      canvas.height = height
      context.drawImage(video, 0, 0, width, height)
      const imageData = context.getImageData(0, 0, width, height)
      if (!imageData?.data || imageData.data.length !== width * height * 4)
        throw failure('IO', 'Browser returned an invalid image')
      const buffer = new ArrayBuffer(width * height * 2)
      writeImageDataRgb565Le(new Uint8Array(buffer), imageData)
      return { width, height, imageType, buffer, source: 'native' }
    },
  }
  return bridge
}

export { createHostAudioInBridge } from './audio-input.mjs'

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
