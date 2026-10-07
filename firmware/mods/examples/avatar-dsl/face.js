// SPDX-License-Identifier: Apache-2.0

import Resource from 'Resource'
import { Outline } from 'commodetto/outline'
import { copyFaceState, createFaceState } from 'face-state'
import { Container, Port, Skin } from 'piu/MC'
import { Shape } from 'piu/shape'
import { createContext, updateContext } from './context.js'
import { FaceDriver } from './driver.js'
import { Op } from './vendor/compiler/opcodes.js'
import { AvatarVM, COMMAND_STRIDE, MAX_COMMANDS } from './vm.js'

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
class AvatarBehavior extends Behavior {
  constructor(buffer, options) {
    super()
    this.breathPixels = 0
    this.preservePositionOnSwap = false
    this.options = options
    this.desired = createFaceState()
    this.context = createContext(options)
    this.vm = new AvatarVM(buffer, options.budget)
    this.safeVM = new AvatarVM(loadPreset())
    this.driver = new FaceDriver(() => this.render())
    this.shapes = []
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
      content.add(shape)
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
      this.context = createContext({ width: this.context[0], height: this.context[1] })
      this.options = {}
      updateContext(this.context, this.desired, this.driver.elapsed, this.driver.openness(), this.options)
      vm = this.safeVM
      vm.run(this.context)
    }
    this.present(vm)
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
    for (let i = 0; i < count; i++) {
      const offset = i * COMMAND_STRIDE,
        shape = this.shapes[i]
      let different = i >= this.previousCount
      for (let j = 0; j < COMMAND_STRIDE; j++) if (commands[offset + j] !== this.previous[offset + j]) different = true
      if (!different) continue
      changed = true
      const op = commands[offset],
        x = commands[offset + 1],
        y = commands[offset + 2],
        w = commands[offset + 3],
        h = commands[offset + 4]
      const drawable = op === Op.FillRect || op === Op.FillCircle || op === Op.FillTriangle
      shape.visible = drawable && (op === Op.FillTriangle || (w > 0 && (op === Op.FillCircle || h > 0)))
      if (!shape.visible) continue
      // Pool is fixed. Changed paths/Skin do allocate in this initial prototype.
      // Groups are buffered-composition hints, never Piu clips/translations.
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
      const color = commands[offset + 7]
      if (!this.skins[i] || this.colors[i] !== color) {
        this.colors[i] = color
        this.skins[i] = new Skin({ fill: colorValue(color) })
      }
      shape.skin = this.skins[i]
    }
    for (let i = count; i < this.previousCount; i++) this.shapes[i].visible = false
    this.previous.set(commands.subarray(0, count * COMMAND_STRIDE))
    this.previousCount = count
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
    behavior = new AvatarBehavior(loadPreset(), {})
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
