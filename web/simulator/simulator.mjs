import * as THREE from 'three'
import { OrbitControls } from 'https://unpkg.com/three@0.164.1/examples/jsm/controls/OrbitControls.js'
import { RoundedBoxGeometry } from 'https://unpkg.com/three@0.164.1/examples/jsm/geometries/RoundedBoxGeometry.js'

import {
  clientPointFromTouch,
  createHostButtonBridge,
  createHostCameraBridge,
  createHostDriverBridge,
  summarizeImageData,
} from './bridge.mjs'
import {
  SCREEN_CANVAS,
  STACKCHAN_FACE_MM,
  STACKCHAN_FOOT_MM,
  computeFootPlacements,
  computeScreenPlane,
  computeStackchanKinematics,
  createRoundedRectPath,
} from './geometry.mjs'

class StackchanScene {
  constructor({ viewport, screen }) {
    this.viewport = viewport
    this.screen = screen
    this.lookAround = false
    this.speaking = false
    this.motionUntil = 0
    this.driverRotation = { y: 0, p: 0, r: 0 }
    this.torqueEnabled = true

    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(0x10141c)
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.1, 1000)
    this.camera.position.set(42, 28, 155)

    this.renderer = new THREE.WebGLRenderer({ canvas: viewport, antialias: true, alpha: false })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))

    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.08
    this.controls.target.set(0, -6, 0)
    this.controls.minDistance = 80
    this.controls.maxDistance = 260
    this.controls.update()

    this.root = new THREE.Group()
    this.scene.add(this.root)
    this.panGroup = new THREE.Group()
    this.tiltGroup = new THREE.Group()
    this.headGroup = new THREE.Group()
    this.feetGroup = new THREE.Group()
    this.root.add(this.panGroup)
    this.panGroup.add(this.tiltGroup)
    this.tiltGroup.add(this.headGroup)
    this.root.add(this.feetGroup)

    this.#createLights()
    this.#createBody()
    this.#createFeet()
    this.#createScreen()
    this.#resize()

    window.addEventListener('resize', () => this.#resize())
  }

  #createLights() {
    this.scene.add(new THREE.HemisphereLight(0xffefe0, 0x223355, 2.6))
    const key = new THREE.DirectionalLight(0xffffff, 3)
    key.position.set(30, 40, 80)
    this.scene.add(key)
    const rim = new THREE.DirectionalLight(0x77bbff, 1.4)
    rim.position.set(-50, 20, -40)
    this.scene.add(rim)
  }

  #createBody() {
    const shape = new THREE.Shape()
    const points = createRoundedRectPath(STACKCHAN_FACE_MM)
    shape.moveTo(points[0].x, points[0].y)
    for (const point of points.slice(1)) shape.lineTo(point.x, point.y)
    shape.closePath()

    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: STACKCHAN_FACE_MM.depth,
      bevelEnabled: true,
      bevelSize: 1.4,
      bevelThickness: STACKCHAN_FACE_MM.bevelThickness,
      bevelSegments: 5,
    })
    geometry.center()

    const material = new THREE.MeshStandardMaterial({
      color: 0xfff1df,
      roughness: 0.54,
      metalness: 0.02,
    })
    this.bodyMaterial = material
    this.body = new THREE.Mesh(geometry, material)
    this.headGroup.add(this.body)

    const outline = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry, 24),
      new THREE.LineBasicMaterial({ color: 0x3d3128, transparent: true, opacity: 0.18 }),
    )
    this.headGroup.add(outline)
  }

  #createFeet() {
    const geometry = new RoundedBoxGeometry(
      STACKCHAN_FOOT_MM.width,
      STACKCHAN_FOOT_MM.height,
      STACKCHAN_FOOT_MM.depth,
      5,
      STACKCHAN_FOOT_MM.radius,
    )
    const outlineGeometry = new THREE.EdgesGeometry(geometry, 24)

    for (const placement of computeFootPlacements()) {
      const foot = new THREE.Mesh(geometry, this.bodyMaterial)
      foot.position.set(placement.x, placement.y, placement.z)
      this.feetGroup.add(foot)

      const outline = new THREE.LineSegments(
        outlineGeometry,
        new THREE.LineBasicMaterial({ color: 0x3d3128, transparent: true, opacity: 0.16 }),
      )
      outline.position.copy(foot.position)
      this.feetGroup.add(outline)
    }
  }

  #createScreen() {
    this.screenTexture = new THREE.CanvasTexture(this.screen)
    this.screenTexture.colorSpace = THREE.SRGBColorSpace
    this.screenTexture.minFilter = THREE.LinearFilter
    this.screenTexture.magFilter = THREE.NearestFilter

    const plane = computeScreenPlane({ margin: 5 })
    const geometry = new THREE.PlaneGeometry(plane.width, plane.height)
    const material = new THREE.MeshBasicMaterial({ map: this.screenTexture, toneMapped: false })
    this.screenMesh = new THREE.Mesh(geometry, material)
    this.screenMesh.position.set(plane.x, plane.y, plane.z)
    this.headGroup.add(this.screenMesh)

    const frame = new THREE.Mesh(
      new THREE.PlaneGeometry(plane.width + 2.4, plane.height + 2.4),
      new THREE.MeshBasicMaterial({ color: 0x211a17 }),
    )
    frame.position.set(plane.x, plane.y, plane.z - 0.03)
    this.headGroup.add(frame)
    this.screenMesh.renderOrder = 1
  }

  #resize() {
    const { width, height } = this.viewport.getBoundingClientRect()
    this.renderer.setSize(width, height, false)
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
  }

  setLookAround(enabled) {
    this.lookAround = enabled
  }

  setSpeaking(enabled) {
    this.speaking = enabled
  }

  runServoMotion() {
    this.motionUntil = performance.now() + 4600
  }

  applyDriverRotation(rotation) {
    this.driverRotation = { ...this.driverRotation, ...rotation }
    this.motionUntil = performance.now() + 120
  }

  setTorqueEnabled(enabled) {
    this.torqueEnabled = enabled
  }

  markScreenDirty() {
    this.screenTexture.needsUpdate = true
  }

  render(timeMs) {
    const transforms = computeStackchanKinematics(timeMs, {
      lookAround: this.lookAround,
      speaking: this.speaking,
      motionUntil: this.motionUntil,
      driverRotation: this.driverRotation,
    })

    this.panGroup.position.set(transforms.pan.pivot.x, transforms.pan.pivot.y, transforms.pan.pivot.z)
    this.panGroup.rotation.set(transforms.pan.rotation.x, transforms.pan.rotation.y, transforms.pan.rotation.z)
    this.tiltGroup.position.set(transforms.tilt.pivot.x, transforms.tilt.pivot.y, transforms.tilt.pivot.z)
    this.tiltGroup.rotation.set(transforms.tilt.rotation.x, transforms.tilt.rotation.y, transforms.tilt.rotation.z)
    this.headGroup.rotation.set(
      transforms.head.rotation.x,
      transforms.head.rotation.y,
      transforms.head.rotation.z,
    )
    this.headGroup.scale.set(transforms.head.scale.x, transforms.head.scale.y, transforms.head.scale.z)
    this.feetGroup.rotation.set(
      transforms.feet.rotation.x,
      transforms.feet.rotation.y,
      transforms.feet.rotation.z,
    )
    this.feetGroup.scale.set(transforms.feet.scale.x, transforms.feet.scale.y, transforms.feet.scale.z)

    this.markScreenDirty()
    this.controls.update()
    this.renderer.render(this.scene, this.camera)
  }
}

class WasmView {
  constructor({ scene, screen, info }) {
    this.scene = scene
    this.screen = screen
    this.info = info
    this.interval = 0
    this.tracking = 0
    this.when = 0
    this.image = null
    this.bufferChangeCount = 0

    this.#bindTouches()
  }

  start() {
    this.#loadWasm()
  }

  #bindTouches() {
    this.screen.addEventListener('mousedown', (event) => this.#mouse(event, 0))
    this.screen.addEventListener('mousemove', (event) => this.tracking && this.#mouse(event, 3))
    this.screen.addEventListener('mouseup', (event) => this.#mouse(event, 2))
    this.screen.addEventListener('touchstart', (event) => this.#touches(event, 0), { passive: false })
    this.screen.addEventListener('touchmove', (event) => this.#touches(event, 3), { passive: false })
    this.screen.addEventListener('touchend', (event) => this.#touches(event, 2), { passive: false })
    this.screen.addEventListener('touchcancel', (event) => this.#touches(event, 1), { passive: false })
  }

  async #loadWasm() {
    try {
      console.log('[bridge] importing mc.js')
      const ns = await import('./mc.js')
      this.mc = await ns.default({
        locateFile: () => './mc.wasm',
        print: (text) => console.log(`[firmware] ${text}`),
        printErr: (text) => console.error(`[firmware:err] ${text}`),
      })
      console.log('[bridge] mc.js module ready')
      this.fxMainIdle = this.mc._fxMainIdle
      this.fxMainLaunch = this.mc._fxMainLaunch
      this.fxMainQuit = this.mc._fxMainQuit
      this.fxMainTouch = this.mc._fxMainTouch
      this.launch()
    } catch (error) {
      console.error('[bridge] WASM load failed', error)
      this.info.textContent = `WASM未検出: firmware で npm run build:wasm を実行し、mc.js / mc.wasm を web/simulator/ にコピーしてください。(${error.message})`
      this.#drawFallbackFace()
    }
  }

  #drawFallbackFace() {
    const ctx = this.screen.getContext('2d')
    ctx.fillStyle = '#fff5e8'
    ctx.fillRect(0, 0, this.screen.width, this.screen.height)
    ctx.fillStyle = '#1f1a17'
    ctx.beginPath()
    ctx.arc(108, 96, 18, 0, Math.PI * 2)
    ctx.arc(212, 96, 18, 0, Math.PI * 2)
    ctx.fill()
    ctx.lineWidth = 8
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(130, 154)
    ctx.quadraticCurveTo(160, 178, 194, 154)
    ctx.stroke()
    this.scene.markScreenDirty()
  }

  launch(archive) {
    console.log('[bridge] launch', { width: this.screen.width, height: this.screen.height, hasArchive: Boolean(archive) })
    const pointer = this.fxMainLaunch(this.screen.width, this.screen.height, archive)
    console.log('[bridge] fxMainLaunch returned', { pointer })
    const array = new Uint8ClampedArray(this.mc.HEAP8.buffer, pointer, this.screen.width * this.screen.height * 4)
    this.image = new ImageData(array, this.screen.width, this.screen.height)
  }

  idle(timeStamp) {
    if (this.fxMainIdle && this.when <= timeStamp) {
      this.when = timeStamp + this.interval
      this.fxMainIdle()
    }
  }

  onBufferChanged() {
    if (!this.image) {
      console.warn('[bridge] onBufferChanged before image allocation')
      return
    }
    this.bufferChangeCount += 1
    this.screen.getContext('2d').putImageData(this.image, 0, 0)
    this.scene.markScreenDirty()
    if (this.bufferChangeCount <= 3) {
      console.log('[bridge] onBufferChanged', {
        count: this.bufferChangeCount,
        ...summarizeImageData(this.image),
      })
    }
  }

  onFormatChanged(which, major, minor, patch) {
    const pixelFormats = [
      '16-bit RGB 565 Little Endian',
      '16-bit RGB 565 Big Endian',
      '8-bit Gray',
      '8-bit RGB 332',
      '4-bit Gray',
      '4-bit Color Look-up Table',
    ]
    const format = pixelFormats[which] ?? `format ${which}`
    console.log('[bridge] onFormatChanged', { which, format, xs: `${major}.${minor}.${patch}` })
    this.info.textContent = `WASM ready: ${format} / XS ${major}.${minor}.${patch}`
  }

  onStart(interval) {
    console.log('[bridge] onStart', { interval })
    this.interval = interval
    this.when = performance.now()
  }

  onStop() {
    console.log('[bridge] onStop')
    this.interval = 0
  }

  #mouse(event, kind) {
    event.preventDefault()
    if (kind === 0) this.tracking++
    if (kind === 1 || kind === 2) this.tracking--
    this.#touch(kind, 0, event.clientX, event.clientY, event.timeStamp)
  }

  #touches(event, kind) {
    event.preventDefault()
    if (kind === 0) this.tracking += event.changedTouches.length
    if (kind === 1 || kind === 2) this.tracking -= event.changedTouches.length
    for (const touch of event.changedTouches) {
      const point = clientPointFromTouch(touch)
      this.#touch(kind, touch.identifier, point.x, point.y, event.timeStamp)
    }
  }

  #touch(kind, index, x, y, when) {
    if (!this.image || !this.fxMainTouch) return
    const bounds = this.screen.getBoundingClientRect()
    this.fxMainTouch(kind, index, x - bounds.left, y - bounds.top, when)
  }
}

const viewport = document.getElementById('stackchan-viewport')
const screen = document.getElementById('simulator-screen')
const info = document.getElementById('simulator-info')
const buttonBridge = createHostButtonBridge({ logger: (message) => console.log(message) })
globalThis.Host = { Button: buttonBridge.Button }
console.log('[bridge] global Host.Button constructors installed')

const scene = new StackchanScene({ viewport, screen })
const driverBridge = createHostDriverBridge({
  onRotation: (rotation, time) => {
    console.log('[bridge] Host.Driver.applyRotation', { rotation, time })
    scene.applyDriverRotation(rotation)
  },
  onTorque: (torque) => {
    console.log('[bridge] Host.Driver.setTorque', { torque })
    scene.setTorqueEnabled(torque)
  },
})
globalThis.Host.Driver = driverBridge
console.log('[bridge] global Host.Driver bridge installed')
globalThis.Host.Camera = createHostCameraBridge()
console.log('[bridge] global Host.Camera bridge installed')
buttonBridge.setHtmlAction('a', () => scene.setLookAround(!scene.lookAround))
buttonBridge.setHtmlAction('b', () => scene.runServoMotion())

const wasmView = new WasmView({ scene, screen, info })
globalThis.gxView = wasmView
console.log('[bridge] global gxView installed')
wasmView.start()

document.getElementById('button-a').addEventListener('click', () => buttonBridge.push('a'))
document.getElementById('button-b').addEventListener('click', () => buttonBridge.push('b'))
document.getElementById('button-c').addEventListener('click', () => buttonBridge.push('c'))
document.getElementById('speech-toggle').addEventListener('click', (event) => {
  const next = event.currentTarget.getAttribute('aria-pressed') !== 'true'
  event.currentTarget.setAttribute('aria-pressed', String(next))
  scene.setSpeaking(next)
})

function animate(timeMs) {
  wasmView.idle(timeMs)
  scene.render(timeMs)
  window.requestAnimationFrame(animate)
}

window.requestAnimationFrame(animate)
