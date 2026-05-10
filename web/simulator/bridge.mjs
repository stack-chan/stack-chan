const BUTTON_NAMES = ['a', 'b', 'c']

export function createHostButtonBridge({ logger = console.log, setTimeoutFn = globalThis.setTimeout, resetDelayMs = 120 } = {}) {
  const states = Object.fromEntries(
    BUTTON_NAMES.map((name) => [name, { pressed: 1, firmwareCallbacks: new Set() }]),
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
    push(name) {
      const state = states[name]
      if (!state) return
      logger(`[bridge] Host.Button.${name} pushed`)
      state.pressed = 0
      for (const callback of state.firmwareCallbacks) callback()
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

export function createHostAudioOutBridge({ createAudioContext = defaultAudioContextFactory } = {}) {
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
        oscillator.onended = resolve
        try {
          oscillator.start(startTime)
          oscillator.stop(startTime + duration / 1000)
        } catch (error) {
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
        source.onended = resolve
        try {
          source.start(0)
        } catch (error) {
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
