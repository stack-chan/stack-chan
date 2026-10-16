// SPDX-License-Identifier: Apache-2.0

import Resource from 'Resource'
import { commandClips } from 'avatar-dsl/clips'
import { createContext, updateContext } from 'avatar-dsl/context'
import { FaceDriver } from 'avatar-dsl/driver'
import { Op } from 'avatar-dsl/vendor/compiler/opcodes'
import { AvatarVM, COMMAND_STRIDE, MAX_COMMANDS } from 'avatar-dsl/vm'
import { Outline } from 'commodetto/outline'
import { copyFaceState, createFaceState } from 'face-state'
import { Container, Port, Skin } from 'piu/MC'
import { Shape } from 'piu/shape'

export function loadPreset(name = 'default') {
  const names = { default: 'default_face', omega: 'omega_mouth', aokko: 'aokko_face' }
  if (!names[name]) throw new Error('AVDS: unknown preset')
  return new Resource(`${names[name]}.avbc`)
}
function colorValue(value) {
  const r = (value >> 11) & 31,
    g = (value >> 5) & 63,
    b = value & 31
  return (((r << 3) | (r >> 2)) * 0x1000000 + (((g << 2) | (g >> 4)) << 16) + (((b << 3) | (b >> 2)) << 8) + 255) >>> 0
}
// Keep validated canvas geometry, but discard tuning and execution overrides.
function fallbackOptions({ width = 320, height = 240, circular = false }) {
  const geometry = { width, height, circular }
  try {
    createContext(geometry)
    return geometry
  } catch {
    return {}
  }
}
class AvatarBehavior extends Behavior {
  constructor(buffer, options) {
    super()
    this.breathPixels = 0
    this.preservePositionOnSwap = false
    this.options = options
    this.desired = createFaceState()
    this.context = createContext(options)
    this.contextWords = new Uint32Array(this.context.buffer)
    this.lastContextWords = new Uint32Array(this.context.length)
    this.hasFrame = false
    this.vm = new AvatarVM(buffer, options.budget)
    this.safeVM = new AvatarVM(loadPreset())
    this.driver = new FaceDriver(() => this.render())
    this.shapes = []
    this.clipContainers = []
    this.previousClips = []
    this.previous = new Int32Array(MAX_COMMANDS * COMMAND_STRIDE)
    this.previousCount = -1
    this.colors = new Uint16Array(MAX_COMMANDS)
    this.skins = new Array(MAX_COMMANDS)
    this.background = -1
    this.failure = null
    this.renderFailures = 0
    this.base = { left: 0, top: 0 }
  }
  onCreate(content) {
    content.interval = 33
  }
  attach(content) {
    this.content = content
    for (let i = 0; i < MAX_COMMANDS; i++) {
      const shape = new Shape(null, {
        left: 0,
        top: 0,
        width: this.context[0],
        height: this.context[1],
        clip: false,
        visible: false,
      })
      this.shapes.push(shape)
      const clip = new Container(null, {
        left: 0,
        top: 0,
        width: this.context[0],
        height: this.context[1],
        clip: true,
        contents: [shape],
      })
      this.clipContainers.push(clip)
      content.add(clip)
    }
    this.invalidator = new Port(null, { left: 0, top: 0, width: this.context[0], height: this.context[1] })
    content.add(this.invalidator)
    this.render()
  }
  onFaceUpdate(_content, state) {
    copyFaceState(state, this.desired)
    if (!this.driver.paused && !this.driver.disposed) this.render()
  }
  onFaceState(content, state) {
    this.onFaceUpdate(content, state)
  }
  rehydrate(content, state) {
    this.driver.lastTime = content.time
    this.onFaceUpdate(content, state)
  }
  onDisplaying(content) {
    this.driver.display(content)
  }
  onUndisplaying(content) {
    this.driver.undisplay(content)
  }
  onTimeChanged(content) {
    this.driver.tick(content)
  }
  setMotionsEnabled(content, enabled) {
    this.driver.motions(content, enabled)
  }
  pause(content) {
    this.driver.pause(content)
  }
  resume(content) {
    this.driver.resume(content)
  }
  dispose(content) {
    this.driver.dispose(content)
  }
  getBaseCoordinates(content) {
    this.base.left = content.coordinates.left ?? 0
    this.base.top = content.coordinates.top ?? 0
    return this.base
  }
  onTouchEnded(content) {
    content.bubble('onFaceTouch')
  }
  render() {
    if (!this.content || this.driver.disposed || this.driver.paused) return
    updateContext(this.context, this.desired, this.driver.elapsed, this.driver.openness(), this.options)
    // Reuse only an exactly identical complete float32 context, including time
    // and signed zero. State changes and every changed clock still run the VM.
    if (this.hasFrame) {
      let same = true
      for (let i = 0; i < this.contextWords.length; i++)
        if (this.contextWords[i] !== this.lastContextWords[i]) {
          same = false
          break
        }
      if (same) return
    }
    let vm = this.failure ? this.safeVM : this.vm
    try {
      vm.run(this.context)
      let primitives = 0
      for (let i = 0; i < vm.count; i++) if (vm.commands[i * COMMAND_STRIDE] < Op.BeginGroup) primitives++
      // Host Application has 4096-byte display/command lists. Reserve room for
      // host UI and reject excessive Outline commands before Piu draws them.
      if (primitives > 32) throw new Error('AVDS: Piu primitive budget')
    } catch (error) {
      this.failure = String(error)
      this.renderFailures++
      trace(`[avatar-dsl] ${this.failure}; using safe default\n`)
      // Reset hostile tuning as well as bytecode. Preserve current host state.
      this.options = fallbackOptions(this.options)
      this.context = createContext(this.options)
      this.contextWords = new Uint32Array(this.context.buffer)
      updateContext(this.context, this.desired, this.driver.elapsed, this.driver.openness(), this.options)
      vm = this.safeVM
      vm.run(this.context)
    }
    this.present(vm)
    this.lastContextWords.set(this.contextWords)
    this.hasFrame = true
  }
  present(vm) {
    const commands = vm.commands,
      count = vm.count
    const bg = this.context[11]
    if (bg !== this.background) {
      this.content.skin = new Skin({ fill: colorValue(bg) })
      this.background = bg
    }
    let changed = count !== this.previousCount
    const clips = commandClips(commands, count, this.context[0], this.context[1])
    for (let i = 0; i < count; i++) {
      const offset = i * COMMAND_STRIDE,
        shape = this.shapes[i]
      let geometryChanged = i >= this.previousCount
      for (let j = 0; j < COMMAND_STRIDE - 1; j++)
        if (commands[offset + j] !== this.previous[offset + j]) geometryChanged = true
      const colorChanged = i >= this.previousCount || commands[offset + 7] !== this.previous[offset + 7]
      const clip = clips[i],
        previousClip = this.previousClips[i]
      const clipChanged =
        !!clip &&
        (!previousClip ||
          clip.x !== previousClip.x ||
          clip.y !== previousClip.y ||
          clip.w !== previousClip.w ||
          clip.h !== previousClip.h)
      if (!geometryChanged && !colorChanged && !clipChanged) continue
      changed = true
      const op = commands[offset],
        x = commands[offset + 1],
        y = commands[offset + 2],
        w = commands[offset + 3],
        h = commands[offset + 4]
      const drawable = op === Op.FillRect || op === Op.FillCircle || op === Op.FillTriangle
      shape.visible =
        drawable && clip.w > 0 && clip.h > 0 && (op === Op.FillTriangle || (w > 0 && (op === Op.FillCircle || h > 0)))
      if (clipChanged) {
        this.clipContainers[i].coordinates = { left: clip.x, top: clip.y, width: clip.w, height: clip.h }
        shape.coordinates = { left: -clip.x, top: -clip.y, width: this.context[0], height: this.context[1] }
      }
      if (!drawable || (op !== Op.FillTriangle && (w <= 0 || (op === Op.FillRect && h <= 0)))) continue
      // Pool is fixed. Changed paths/Skin do allocate in this initial prototype.
      // Absolute paths keep their canvas coordinates inside a clipping parent.
      if (geometryChanged) {
        const path = new Outline.CanvasPath()
        if (op === Op.FillRect) path.rect(x, y, w, h)
        else if (op === Op.FillCircle) path.arc(x, y, w, 0, Math.PI * 2)
        else {
          path.moveTo(x, y)
          path.lineTo(w, h)
          path.lineTo(commands[offset + 5], commands[offset + 6])
        }
        path.closePath()
        shape.fillOutline = Outline.fill(path)
      }
      const color = commands[offset + 7]
      if (!this.skins[i] || this.colors[i] !== color) {
        this.colors[i] = color
        this.skins[i] = new Skin({ fill: colorValue(color) })
      }
      shape.skin = this.skins[i]
    }
    for (let i = count; i < this.previousCount; i++) this.shapes[i].visible = false
    for (let i = 0; i < count * COMMAND_STRIDE; i++) this.previous[i] = commands[i]
    this.previousCount = count
    this.previousClips = clips
    // Full damage is deliberate until command dirty bounds are validated.
    if (changed) this.invalidator.invalidate(0, 0, this.context[0], this.context[1])
  }
}

/** Compatible with robot.ui.setFace(content); no host extension needed. */
export function createAvatarFace({ preset = 'default', bytecode, ...options } = {}) {
  let behavior
  try {
    behavior = new AvatarBehavior(bytecode ?? loadPreset(preset), options)
  } catch (error) {
    trace(`[avatar-dsl] ${String(error)}; using safe default\n`)
    behavior = new AvatarBehavior(loadPreset(), fallbackOptions(options))
    behavior.failure = String(error)
  }
  const content = new Container(null, {
    left: 0,
    top: 0,
    width: behavior.context[0],
    height: behavior.context[1],
    clip: true,
    active: true,
    behavior,
  })
  behavior.attach(content)
  return { content, dispose: () => behavior.dispose(content) }
}
