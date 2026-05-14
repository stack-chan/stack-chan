const BUTTON_NAMES = ['a', 'b', 'c']
const MOD_INSTALL_HOOKS = ['_fxMainSetModArchive', '_wasmModInstallArchive']

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

export function createHostAudioOutBridge({ createAudioContext = defaultAudioContextFactory } = {}) {
  let context

  return {
    async tone({ hz = 440, duration = 100, volume = 1 } = {}) {
      context ??= createAudioContext()
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      oscillator.frequency.value = hz
      gain.gain.value = volume
      oscillator.connect(gain)
      gain.connect(context.destination)
      const startTime = context.currentTime
      await new Promise((resolve, reject) => {
        oscillator.onended = resolve
        try {
          oscillator.start(startTime)
          oscillator.stop(startTime + duration / 1000)
        } catch (error) {
          reject(error)
        }
      })
    },
    close() {
      context?.close?.()
      context = undefined
    },
  }
}

export function createHostAudioInBridge({
  mediaDevices = globalThis.navigator?.mediaDevices,
  MediaRecorder = globalThis.MediaRecorder,
  setTimeoutFn = globalThis.setTimeout,
} = {}) {
  return {
    async record(durationMilliSec = 3000) {
      if (!mediaDevices?.getUserMedia || !MediaRecorder) return new ArrayBuffer(0)
      if (typeof MediaRecorder.isTypeSupported === 'function' && !MediaRecorder.isTypeSupported('audio/wav')) {
        return new ArrayBuffer(0)
      }

      const stream = await mediaDevices.getUserMedia({ audio: true })
      const chunks = []
      try {
        return await new Promise((resolve) => {
          const recorder = new MediaRecorder(stream, { mimeType: 'audio/wav' })
          recorder.ondataavailable = (event) => {
            if (event.data) chunks.push(event.data)
          }
          recorder.onstop = async () => {
            const buffer = await chunksToArrayBuffer(chunks)
            resolve(isWavBuffer(buffer) ? buffer : new ArrayBuffer(0))
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
    }),
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
