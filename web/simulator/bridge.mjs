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

export function createHostButtonBridge({
  logger = console.log,
  setTimeoutFn = globalThis.setTimeout,
  resetDelayMs = 120,
} = {}) {
  const states = Object.fromEntries(
    BUTTON_NAMES.map((name) => [name, { pressed: 1, firmwareCallbacks: new Set(), htmlAction: undefined }])
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
    ])
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

export function installModArchiveIntoWasm(wasmModule, installedMod) {
  if (!installedMod) return { status: 'empty' }

  const bytes = installedMod.bytes instanceof Uint8Array ? installedMod.bytes : new Uint8Array(installedMod.bytes ?? [])
  const size = installedMod.size ?? bytes.byteLength
  const hookName = MOD_INSTALL_HOOKS.find((name) => typeof wasmModule?.[name] === 'function')

  if (typeof wasmModule?._malloc !== 'function' || !wasmModule.HEAPU8) {
    return { status: 'unsupported', name: installedMod.name, size }
  }

  const pointer = wasmModule._malloc(bytes.byteLength)
  wasmModule.HEAPU8.set(bytes, pointer)

  if (!hookName) return { status: 'prepared', pointer, name: installedMod.name, size }

  try {
    const result = wasmModule[hookName](pointer, bytes.byteLength)
    return { status: 'installed', hook: hookName, name: installedMod.name, size, result }
  } finally {
    wasmModule._free?.(pointer)
  }
}

export function createHostAudioOutBridge({
  createAudioContext = defaultAudioContextFactory,
  setTimeoutFn = globalThis.setTimeout,
  clearTimeoutFn = globalThis.clearTimeout,
} = {}) {
  let context

  return {
    async tone({ hz = 440, duration = 100, volume = 1 } = {}) {
      context ??= createAudioContext()
      if (context.state === 'suspended' && typeof context.resume === 'function') {
        await context.resume()
      }
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      oscillator.frequency.value = hz
      gain.gain.value = volume
      oscillator.connect(gain)
      gain.connect(context.destination)
      const startTime = context.currentTime
      await new Promise((resolve, reject) => {
        let fallback
        const finish = () => {
          if (fallback !== undefined) clearTimeoutFn?.(fallback)
          resolve()
        }
        oscillator.onended = finish
        try {
          oscillator.start(startTime)
          oscillator.stop(startTime + duration / 1000)
          fallback = setTimeoutFn?.(finish, duration + 250)
        } catch (error) {
          if (fallback !== undefined) clearTimeoutFn?.(fallback)
          reject(error)
        }
      })
    },
    async play(buffer) {
      if (!(buffer instanceof ArrayBuffer) || buffer.byteLength === 0) return false
      context ??= createAudioContext()
      if (context.state === 'suspended' && typeof context.resume === 'function') {
        await context.resume()
      }
      if (typeof context.decodeAudioData !== 'function') return false

      const audioBuffer = await decodeAudioData(context, buffer)
      const source = context.createBufferSource()
      source.buffer = audioBuffer
      source.connect(context.destination)
      await new Promise((resolve, reject) => {
        let fallback
        const durationMilliSec = Number.isFinite(audioBuffer.duration) ? audioBuffer.duration * 1000 : 0
        const finish = () => {
          if (fallback !== undefined) clearTimeoutFn?.(fallback)
          resolve()
        }
        source.onended = finish
        try {
          source.start(0)
          if (durationMilliSec > 0) {
            fallback = setTimeoutFn?.(finish, durationMilliSec + 250)
          }
        } catch (error) {
          if (fallback !== undefined) clearTimeoutFn?.(fallback)
          reject(error)
        }
      })
      return true
    },
    close() {
      context?.close?.()
      context = undefined
    },
  }
}

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
  logger = console,
  navigatorObj = globalThis.navigator,
  videoElement,
  canvasElement,
} = {}) {
  let started = false
  let browserCameraRequested = false
  let browserCameraStarted = false
  let mediaStream
  let mediaVideo = videoElement
  let mediaCanvas = canvasElement
  let browserStartGeneration = 0

  const logWarning = (message, error) => {
    if (error) {
      logger?.warn?.(message, error)
    } else {
      logger?.warn?.(message)
    }
  }

  const ensureVideoElement = () => {
    if (mediaVideo) return mediaVideo
    if (!documentObj?.createElement) return undefined

    mediaVideo = documentObj.createElement('video')
    mediaVideo.muted = true
    mediaVideo.playsInline = true
    return mediaVideo
  }

  const ensureCanvasElement = () => {
    if (mediaCanvas) return mediaCanvas
    if (!documentObj?.createElement) return undefined

    mediaCanvas = documentObj.createElement('canvas')
    return mediaCanvas
  }

  const stopBrowserCamera = () => {
    browserStartGeneration += 1
    for (const track of mediaStream?.getTracks?.() ?? []) track.stop?.()
    mediaStream = undefined
    browserCameraStarted = false
    if (mediaVideo) mediaVideo.srcObject = null
  }

  const startBrowserCamera = async (options = {}) => {
    if (browserCameraStarted && mediaStream && mediaVideo?.srcObject === mediaStream) return true

    stopBrowserCamera()

    const getUserMedia = navigatorObj?.mediaDevices?.getUserMedia?.bind(navigatorObj.mediaDevices)
    if (!getUserMedia) {
      browserCameraStarted = false
      return false
    }

    const video = ensureVideoElement()
    if (!video) {
      browserCameraStarted = false
      return false
    }

    try {
      const startGeneration = browserStartGeneration
      const stream = await getUserMedia({ video: options.video ?? true })
      if (startGeneration !== browserStartGeneration || !started || !browserCameraRequested) {
        for (const track of stream?.getTracks?.() ?? []) track.stop?.()
        return false
      }

      mediaStream = stream
      video.srcObject = mediaStream
      if (typeof video.play === 'function') await video.play()
      browserCameraStarted = true
      return true
    } catch (error) {
      stopBrowserCamera()
      logWarning('[bridge] browser camera unavailable; using synthetic Host.Camera fallback', error)
      return false
    }
  }

  const captureBrowserCamera = (options = {}) => {
    if (!started || !browserCameraRequested || !browserCameraStarted) return undefined
    if (!mediaVideo || mediaVideo.readyState < HAVE_CURRENT_DATA || !mediaVideo.videoWidth || !mediaVideo.videoHeight) {
      return undefined
    }

    const canvas = ensureCanvasElement()
    const context = canvas?.getContext?.('2d', { willReadFrequently: true })
    if (!canvas || !context?.drawImage || !context?.getImageData) return undefined

    const width = normalizeDimension(options.width, DEFAULT_CAMERA_WIDTH)
    const height = normalizeDimension(options.height, DEFAULT_CAMERA_HEIGHT)

    try {
      canvas.width = width
      canvas.height = height
      context.drawImage(mediaVideo, 0, 0, width, height)

      const imageData = context.getImageData(0, 0, width, height)
      if (!imageData?.data || imageData.data.length < width * height * 4) return undefined

      const buffer = new ArrayBuffer(width * height * 2)
      writeImageDataRgb565Le(new Uint8Array(buffer), imageData)

      return { width, height, imageType: 'rgb565le', buffer }
    } catch (error) {
      logWarning('[bridge] browser camera capture failed; using synthetic Host.Camera fallback', error)
      return undefined
    }
  }

  return {
    async start(options = {}) {
      started = true
      if (Object.hasOwn(options, 'useBrowserCamera')) {
        browserCameraRequested = Boolean(options.useBrowserCamera)
        if (browserCameraRequested) {
          await startBrowserCamera(options)
        } else {
          stopBrowserCamera()
        }
      }
    },
    stop() {
      started = false
      browserCameraRequested = false
      stopBrowserCamera()
    },
    isStarted() {
      return started
    },
    isBrowserCameraStarted() {
      return browserCameraStarted
    },
    capture(options = {}) {
      const imageType = options.imageType ?? DEFAULT_CAMERA_IMAGE_TYPE
      if (imageType !== 'rgb565le') return undefined

      return captureBrowserCamera(options) ?? createSyntheticCameraFrame(options)
    },
  }
}

function decodeAudioData(context, buffer) {
  return new Promise((resolve, reject) => {
    const result = context.decodeAudioData(buffer.slice(0), resolve, reject)
    if (result && typeof result.then === 'function') {
      result.then(resolve, reject)
    }
  })
}

export function createHostAudioInBridge({
  mediaDevices = globalThis.navigator?.mediaDevices,
  MediaRecorder = globalThis.MediaRecorder,
  setTimeoutFn = globalThis.setTimeout,
} = {}) {
  return {
    async record(durationMilliSec = 3000) {
      if (!mediaDevices?.getUserMedia || !MediaRecorder) return new ArrayBuffer(0)
      const format = selectAudioRecordingFormat(MediaRecorder)
      if (!format) {
        return new ArrayBuffer(0)
      }

      const stream = await mediaDevices.getUserMedia({ audio: true })
      const chunks = []
      try {
        return await new Promise((resolve) => {
          const recorder = new MediaRecorder(stream, { mimeType: format.mimeType })
          recorder.ondataavailable = (event) => {
            if (event.data) chunks.push(event.data)
          }
          recorder.onstop = async () => {
            const buffer = await chunksToArrayBuffer(chunks)
            resolve(attachAudioMetadata(isSupportedAudioBuffer(buffer, format) ? buffer : new ArrayBuffer(0), format))
          }
          recorder.start()
          setTimeoutFn(() => recorder.stop(), durationMilliSec)
        })
      } finally {
        for (const track of stream.getTracks?.() ?? []) track.stop?.()
      }
    },
  }
}

const AUDIO_RECORDING_FORMATS = Object.freeze([
  { mimeType: 'audio/webm;codecs=opus', extension: 'webm' },
  { mimeType: 'audio/webm', extension: 'webm' },
  { mimeType: 'audio/mp4', extension: 'm4a' },
  { mimeType: 'audio/wav', extension: 'wav' },
])

function selectAudioRecordingFormat(MediaRecorder) {
  if (typeof MediaRecorder.isTypeSupported !== 'function') return AUDIO_RECORDING_FORMATS[0]
  return AUDIO_RECORDING_FORMATS.find(({ mimeType }) => MediaRecorder.isTypeSupported(mimeType))
}

function isSupportedAudioBuffer(buffer, format) {
  if (format.mimeType === 'audio/wav') return isWavBuffer(buffer)
  return buffer instanceof ArrayBuffer && buffer.byteLength > 0
}

function attachAudioMetadata(buffer, format) {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength === 0) return buffer
  const metadata = {
    mimeType: format.mimeType,
    filename: `speak.${format.extension}`,
  }
  try {
    Object.defineProperties(buffer, {
      mimeType: { value: metadata.mimeType, configurable: true },
      filename: { value: metadata.filename, configurable: true },
    })
  } catch {
    buffer.mimeType = metadata.mimeType
    buffer.filename = metadata.filename
  }
  return buffer
}

function defaultAudioContextFactory() {
  const AudioContextConstructor = globalThis.AudioContext ?? globalThis.webkitAudioContext
  if (!AudioContextConstructor) throw new Error('WebAudio AudioContext is not available')
  return new AudioContextConstructor()
}

async function chunksToArrayBuffer(chunks) {
  const buffers = await Promise.all(
    chunks.map(async (chunk) => {
      if (chunk instanceof ArrayBuffer) return chunk
      if (ArrayBuffer.isView(chunk)) return chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength)
      if (typeof chunk.arrayBuffer === 'function') return chunk.arrayBuffer()
      return new ArrayBuffer(0)
    })
  )
  const total = buffers.reduce((sum, buffer) => sum + buffer.byteLength, 0)
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const buffer of buffers) {
    bytes.set(new Uint8Array(buffer), offset)
    offset += buffer.byteLength
  }
  return bytes.buffer
}

function isWavBuffer(buffer) {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 12) return false
  const bytes = new Uint8Array(buffer)
  return (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x41 &&
    bytes[10] === 0x56 &&
    bytes[11] === 0x45
  )
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
