// SPDX-License-Identifier: Apache-2.0

import Resource from 'Resource'
import { createContext, updateContext } from 'avatar-dsl/context'
import { createFaceState } from 'face-state'
import Modules from 'modules'
import { Container } from 'piu/MC'

export function loadPreset(name = 'default') {
  const names = { default: 'default_face', omega: 'omega_mouth', aokko: 'aokko_face' }
  if (!names[name]) throw new Error('AVDS: unknown preset')
  return new Resource(`${names[name]}.avbc`)
}

class NativeBehavior extends Behavior {
  constructor(renderer, context, options) {
    super()
    this.renderer = renderer
    this.context = context
    this.options = options
    this.breathPixels = 0
    this.preservePositionOnSwap = false
    this.disposed = false
    this.base = { left: 0, top: 0 }
  }
  get failure() {
    return this.configurationFailure ?? this.renderer.failure
  }
  onFaceUpdate(_content, state) {
    if (this.disposed) return
    // This runs only when host state changes. The native idle/draw dispatches
    // own time, blink, breath, VM execution and Piu/Poco geometry/rendering.
    updateContext(this.context, state, 0, 1, this.options)
    this.renderer.setContext(this.context)
  }
  onFaceState(content, state) {
    this.onFaceUpdate(content, state)
  }
  rehydrate(content, state) {
    this.onFaceUpdate(content, state)
  }
  setMotionsEnabled(_content, enabled) {
    if (!this.disposed) this.renderer.setMotionsEnabled(enabled)
  }
  pause(content) {
    if (this.disposed) return
    this.renderer.pause()
    content.visible = content.active = false
  }
  resume(content) {
    if (this.disposed) return
    content.visible = content.active = true
    this.renderer.resume()
  }
  dispose(content) {
    if (this.disposed) return
    this.disposed = true
    this.renderer.close()
    content.visible = content.active = false
  }
  getBaseCoordinates(content) {
    this.base.left = content.coordinates.left ?? 0
    this.base.top = content.coordinates.top ?? 0
    return this.base
  }
  onTouchEnded(content) {
    content.bubble('onFaceTouch')
  }
}

export function createAvatarFace({ preset = 'default', bytecode, ...options } = {}) {
  if (!Modules.has('avatar-dsl/native'))
    throw new Error('AVDS: native backend requires the updated host; rebuild host before loading this MOD')
  const { NativeFace } = Modules.importNow('avatar-dsl/native')
  let context, safeContext, configurationFailure
  try {
    context = createContext(options)
    safeContext = createContext({ width: options.width, height: options.height, circular: options.circular })
  } catch (error) {
    configurationFailure = String(error)
    options = { width: options.width, height: options.height, circular: options.circular }
    try {
      safeContext = createContext(options)
    } catch {
      options = {}
      safeContext = createContext()
    }
    context = new Float32Array(safeContext)
  }
  updateContext(context, createFaceState(), 0, 1, options)
  const dictionary = { left: 0, top: 0, width: context[0], height: context[1] }
  let renderer = new NativeFace(null, dictionary)
  try {
    renderer.initialize(
      configurationFailure ? new ArrayBuffer(0) : (bytecode ?? loadPreset(preset)),
      loadPreset(),
      context,
      safeContext,
      options.budget?.instructions ?? 12000,
      options.budget?.draws ?? 96,
      options.breathSource === 'state',
    )
  } catch (error) {
    renderer.close()
    configurationFailure = String(error)
    options = { width: context[0], height: context[1] }
    context = new Float32Array(safeContext)
    updateContext(context, createFaceState(), 0, 1, options)
    renderer = new NativeFace(null, dictionary)
    renderer.initialize(new ArrayBuffer(0), loadPreset(), context, safeContext)
  }
  const behavior = new NativeBehavior(renderer, context, options)
  behavior.configurationFailure = configurationFailure
  const content = new Container(null, {
    left: 0,
    top: 0,
    width: context[0],
    height: context[1],
    clip: true,
    active: true,
    behavior,
    contents: [renderer],
  })
  return { content, renderer, dispose: () => behavior.dispose(content) }
}
