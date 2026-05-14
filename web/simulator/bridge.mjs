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
