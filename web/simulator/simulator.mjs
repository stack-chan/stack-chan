import * as THREE from 'three'
import { OrbitControls } from 'https://unpkg.com/three@0.164.1/examples/jsm/controls/OrbitControls.js'
import { RoundedBoxGeometry } from 'https://unpkg.com/three@0.164.1/examples/jsm/geometries/RoundedBoxGeometry.js'
import { STLLoader } from 'https://unpkg.com/three@0.164.1/examples/jsm/loaders/STLLoader.js'

import {
  clientPointFromTouch,
  createHostAudioInBridge,
  createHostAudioOutBridge,
  createHostButtonBridge,
  createHostCameraBridge,
  createHostDriverBridge,
  installModArchiveIntoWasm,
  summarizeImageData,
} from './bridge.mjs'
import {
  SCREEN_CANVAS,
  STACKCHAN_FACE_MM,
  STACKCHAN_FOOT_MM,
  STACKCHAN_SIMULATOR_COLORS,
  STACKCHAN_SHELL_STL,
  computeFaceModulePlacement,
  computeFootPlacements,
  computeScreenPlane,
  computeShellPlacementFromBounds,
  computeStackchanKinematics,
  createRoundedRectPath,
  screenPointFromUv,
  stepRotationToward,
} from './geometry.mjs'
import { createModStorage, formatByteSize } from './mod-storage.mjs'

const DRIVER_MAX_ANGULAR_SPEED = 2.4

class StackchanScene {
  constructor({ viewport, screen }) {
    this.viewport = viewport
    this.screen = screen
    this.lookAround = false
    this.speaking = false
    this.motionUntil = 0
    this.driverRotation = { y: 0, p: 0, r: 0 }
    this.targetDriverRotation = { y: 0, p: 0, r: 0 }
    this.lastDriverUpdateMs = undefined
    this.torqueEnabled = true
    this.raycaster = new THREE.Raycaster()
    this.pointerNdc = new THREE.Vector2()

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
    this.shellMaterial = new THREE.MeshStandardMaterial({
      color: STACKCHAN_SIMULATOR_COLORS.shell,
      roughness: 0.54,
      metalness: 0.02,
    })
    this.m5stackSideMaterial = new THREE.MeshStandardMaterial({
      color: STACKCHAN_SIMULATOR_COLORS.m5stackSide,
      roughness: 0.58,
      metalness: 0.02,
    })
    this.m5stackFrontMaterial = new THREE.MeshStandardMaterial({
      color: STACKCHAN_SIMULATOR_COLORS.m5stackFront,
      roughness: 0.62,
      metalness: 0.02,
    })
    this.footMaterial = new THREE.MeshStandardMaterial({
      color: STACKCHAN_SIMULATOR_COLORS.feet,
      roughness: 0.6,
      metalness: 0.02,
    })
    this.#createShell()
    this.#createFaceModule()
  }

  #createShell() {
    const loader = new STLLoader()
    loader.load(
      STACKCHAN_SHELL_STL.url,
      (geometry) => {
        geometry.computeVertexNormals()
        const placement = computeShellPlacementFromBounds(STACKCHAN_SHELL_STL.sourceBoundsMm)
        this.shell = new THREE.Mesh(geometry, this.shellMaterial)
        this.shell.position.set(placement.position.x, placement.position.y, placement.position.z)
        this.shell.rotation.set(placement.rotation.x, placement.rotation.y, placement.rotation.z)
        this.shell.scale.setScalar(placement.scale)
        this.headGroup.add(this.shell)

        const outline = new THREE.LineSegments(
          new THREE.EdgesGeometry(geometry, 24),
          new THREE.LineBasicMaterial({ color: 0x3d3128, transparent: true, opacity: 0.1 })
        )
        outline.position.copy(this.shell.position)
        outline.rotation.copy(this.shell.rotation)
        outline.scale.copy(this.shell.scale)
        this.headGroup.add(outline)
      },
      undefined,
      (error) => {
        console.warn('[simulator] failed to load shell STL; using generated face module only', error)
      }
    )
  }

  #createFaceModule() {
    const facePlacement = computeFaceModulePlacement()
    const faceDepth = facePlacement.depth
    const shape = new THREE.Shape()
    const points = createRoundedRectPath(STACKCHAN_FACE_MM)
    shape.moveTo(points[0].x, points[0].y)
    for (const point of points.slice(1)) shape.lineTo(point.x, point.y)
    shape.closePath()

    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: faceDepth,
      bevelEnabled: true,
      bevelSize: 1.4,
      bevelThickness: STACKCHAN_FACE_MM.bevelThickness,
      bevelSegments: 5,
    })
    geometry.center()
    geometry.translate(0, 0, facePlacement.z)

    this.faceModule = new THREE.Mesh(geometry, this.m5stackSideMaterial)
    this.headGroup.add(this.faceModule)

    const frontPanelGeometry = new THREE.ShapeGeometry(shape)
    frontPanelGeometry.translate(0, 0, facePlacement.frontZ + STACKCHAN_FACE_MM.bevelThickness + 0.01)
    this.faceFrontPanel = new THREE.Mesh(frontPanelGeometry, this.m5stackFrontMaterial)
    this.headGroup.add(this.faceFrontPanel)

    const outline = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry, 24),
      new THREE.LineBasicMaterial({ color: 0x3d3128, transparent: true, opacity: 0.18 })
    )
    this.headGroup.add(outline)
  }

  #createFeet() {
    const geometry = new RoundedBoxGeometry(
      STACKCHAN_FOOT_MM.width,
      STACKCHAN_FOOT_MM.height,
      STACKCHAN_FOOT_MM.depth,
      5,
      STACKCHAN_FOOT_MM.radius
    )
    const outlineGeometry = new THREE.EdgesGeometry(geometry, 24)

    for (const placement of computeFootPlacements()) {
      const foot = new THREE.Mesh(geometry, this.footMaterial)
      foot.position.set(placement.x, placement.y, placement.z)
      this.feetGroup.add(foot)

      const outline = new THREE.LineSegments(
        outlineGeometry,
        new THREE.LineBasicMaterial({ color: 0x3d3128, transparent: true, opacity: 0.16 })
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
      new THREE.MeshBasicMaterial({ color: 0x211a17 })
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
    this.targetDriverRotation = { ...this.targetDriverRotation, ...rotation }
  }

  setTorqueEnabled(enabled) {
    this.torqueEnabled = enabled
  }

  setViewportControlsEnabled(enabled) {
    this.controls.enabled = enabled
  }

  markScreenDirty() {
    this.screenTexture.needsUpdate = true
  }

  updateDriverRotation(timeMs) {
    if (this.lastDriverUpdateMs === undefined) {
      this.lastDriverUpdateMs = timeMs
      return
    }
    const deltaSeconds = Math.max(0, Math.min((timeMs - this.lastDriverUpdateMs) / 1000, 0.1))
    this.lastDriverUpdateMs = timeMs
    this.driverRotation = stepRotationToward(
      this.driverRotation,
      this.targetDriverRotation,
      deltaSeconds,
      DRIVER_MAX_ANGULAR_SPEED
    )
  }

  screenPointFromViewportEvent(event) {
    const bounds = this.viewport.getBoundingClientRect()
    this.pointerNdc.set(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      -((event.clientY - bounds.top) / bounds.height) * 2 + 1
    )
    this.raycaster.setFromCamera(this.pointerNdc, this.camera)
    const [hit] = this.raycaster.intersectObject(this.screenMesh, false)
    return screenPointFromUv(hit?.uv, { width: this.screen.width, height: this.screen.height })
  }

  render(timeMs) {
    this.updateDriverRotation(timeMs)
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
    this.headGroup.rotation.set(transforms.head.rotation.x, transforms.head.rotation.y, transforms.head.rotation.z)
    this.headGroup.scale.set(transforms.head.scale.x, transforms.head.scale.y, transforms.head.scale.z)
    this.feetGroup.rotation.set(transforms.feet.rotation.x, transforms.feet.rotation.y, transforms.feet.rotation.z)
    this.feetGroup.scale.set(transforms.feet.scale.x, transforms.feet.scale.y, transforms.feet.scale.z)

    this.markScreenDirty()
    this.controls.update()
    this.renderer.render(this.scene, this.camera)
  }
}

class WasmView {
  constructor({ scene, screen, info, traceLog, modStorage, onModInstallStatus = () => {} }) {
    this.scene = scene
    this.screen = screen
    this.info = info
    this.traceLog = traceLog
    this.traceLines = []
    this.modStorage = modStorage
    this.onModInstallStatus = onModInstallStatus
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
      const wasmCacheKey = Date.now()
      const ns = await import(`./mc.js?v=${wasmCacheKey}`)
      this.mc = await ns.default({
        locateFile: () => `./mc.wasm?v=${wasmCacheKey}`,
        print: (text) => this.#handleFirmwarePrint(text),
        printErr: (text) => this.#handleFirmwareError(text),
      })
      console.log('[bridge] mc.js module ready')
      this.fxMainIdle = this.mc._fxMainIdle
      this.fxMainLaunch = this.mc._fxMainLaunch
      this.fxMainQuit = this.mc._fxMainQuit
      this.fxMainTouch = this.mc._fxMainTouch
      const archive = await this.installSavedModArchive()
      this.launch(archive)
    } catch (error) {
      console.error('[bridge] WASM load failed', error)
      this.info.textContent = `WASM未検出: firmware で npm run build:wasm を実行し、mc.js / mc.wasm を web/simulator/ にコピーしてください。(${error.message})`
      this.#drawFallbackFace()
    }
  }

  async installSavedModArchive() {
    try {
      const installedMod = await this.modStorage.loadInstalledMod()
      const result = installModArchiveIntoWasm(this.mc, installedMod)
      console.log('[bridge] MOD archive install', result)
      this.onModInstallStatus(result, installedMod)
      return result.pointer ?? undefined
    } catch (error) {
      const result = { status: 'error', error: error.message }
      console.error('[bridge] MOD archive install failed', error)
      this.onModInstallStatus(result)
      return undefined
    }
  }

  #handleFirmwarePrint(text) {
    this.#applyFirmwareDriverTrace(text)
    this.#appendTrace(text)
    console.log(`[firmware] ${text}`)
  }

  #handleFirmwareError(text) {
    this.#appendTrace(`[err] ${text}`)
    console.error(`[firmware:err] ${text}`)
  }

  #appendTrace(text) {
    if (!this.traceLog) return
    this.traceLines.push(String(text))
    if (this.traceLines.length > 120) {
      this.traceLines.splice(0, this.traceLines.length - 120)
    }
    this.traceLog.textContent = this.traceLines.join('\n')
    this.traceLog.scrollTop = this.traceLog.scrollHeight
  }

  #applyFirmwareDriverTrace(text) {
    if (typeof text !== 'string' || !text.startsWith('[WasmDriver] ')) return
    const rotation = text.match(/^\[WasmDriver\] applyRotation y=([^ ]+) p=([^ ]+) r=([^ ]+) time=([^ ]*)/)
    if (rotation) {
      const [, y, p, r] = rotation
      this.scene.applyDriverRotation({
        y: Number(y),
        p: Number(p),
        r: Number(r),
      })
      return
    }
    const torque = text.match(/^\[WasmDriver\] setTorque torque=([01])/)
    if (torque) {
      this.scene.setTorqueEnabled(torque[1] === '1')
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
    console.log('[bridge] launch', {
      width: this.screen.width,
      height: this.screen.height,
      hasArchive: Boolean(archive),
    })
    const pointer = this.fxMainLaunch(this.screen.width, this.screen.height, archive)
    console.log('[bridge] fxMainLaunch returned', { pointer })
    const array = new Uint8ClampedArray(this.mc.HEAP8.buffer, pointer, this.screen.width * this.screen.height * 4)
    this.image = new ImageData(array, this.screen.width, this.screen.height)
  }

  async restart() {
    if (!this.mc || !this.fxMainLaunch) {
      throw new Error('WASM is not ready')
    }
    console.log('[bridge] restart simulator')
    this.fxMainQuit?.()
    this.interval = 0
    this.when = 0
    this.image = null
    this.bufferChangeCount = 0
    this.screen.getContext('2d').clearRect(0, 0, this.screen.width, this.screen.height)
    this.scene.markScreenDirty()
    const archive = await this.installSavedModArchive()
    this.launch(archive)
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
    this.touchScreenPoint(kind, index, x - bounds.left, y - bounds.top, when)
  }

  touchScreenPoint(kind, index, x, y, when) {
    if (!this.image || !this.fxMainTouch) return
    this.fxMainTouch(kind, index, x, y, when)
  }
}

const viewport = document.getElementById('stackchan-viewport')
const screen = document.getElementById('simulator-screen')
const info = document.getElementById('simulator-info')
const modArchiveInput = document.getElementById('mod-archive-input')
const modRestartButton = document.getElementById('simulator-restart-button')
const modClearButton = document.getElementById('mod-clear-button')
const modInstallStatus = document.getElementById('mod-install-status')
const traceLog = document.getElementById('trace-log')
const modStorage = createModStorage()
const browserCameraButton = document.getElementById('browser-camera-button')
const browserCameraStatus = document.getElementById('browser-camera-status')
const buttonBridge = createHostButtonBridge({ logger: (message) => console.log(message) })
const audioOutBridge = createHostAudioOutBridge()
const audioInBridge = createHostAudioInBridge()
const cameraBridge = createHostCameraBridge()
if (browserCameraButton) {
  browserCameraButton.addEventListener('click', async () => {
    browserCameraButton.disabled = true
    if (browserCameraStatus) browserCameraStatus.textContent = 'ブラウザカメラを開始しています…'
    try {
      await cameraBridge.start({ useBrowserCamera: true })
      if (browserCameraStatus) {
        browserCameraStatus.textContent = cameraBridge.isBrowserCameraStarted()
          ? 'ブラウザカメラ準備完了。ドロワーのCameraでプレビューできます。'
          : 'ブラウザカメラは使えませんでした。合成フレームで続行します。'
      }
    } catch (error) {
      console.warn('[bridge] browser camera button failed', error)
      if (browserCameraStatus)
        browserCameraStatus.textContent = 'ブラウザカメラ開始に失敗しました。合成フレームで続行します。'
    } finally {
      browserCameraButton.disabled = false
    }
  })
}
globalThis.Host = {
  Button: buttonBridge.Button,
  AudioOut: audioOutBridge,
  AudioIn: audioInBridge,
  Camera: cameraBridge,
}
console.log('[bridge] global Host.Button/Audio/Camera constructors installed')

function describeModStatus(result, installedMod = null) {
  if (result?.status === 'prepared') {
    return `MOD: ${result.name} (${formatByteSize(result.size)}) prepared for launch archive`
  }
  if (result?.status === 'installed') {
    return `MOD: ${result.name} (${formatByteSize(result.size)}) installed via ${result.hook}`
  }
  if (result?.status === 'unsupported') {
    return `MOD: ${result.name} (${formatByteSize(result.size)}) saved; this WASM build has no MOD install hook yet`
  }
  if (result?.status === 'error') {
    return `MOD: error (${result.error})`
  }
  if (installedMod) {
    const lifetime = installedMod.storage === 'memory' ? ' stored in memory (session-only)' : ' saved'
    return `MOD: ${installedMod.name} (${formatByteSize(installedMod.size)})${lifetime}`
  }
  return 'MOD: empty'
}

function describeModLaunchInstruction(installedMod) {
  if (installedMod.storage === 'memory') {
    return 'click Restart simulator to launch it during this browser session'
  }
  return 'click Restart simulator to launch it'
}

async function refreshSavedModStatus() {
  try {
    const installedMod = await modStorage.loadInstalledMod()
    modInstallStatus.textContent = describeModStatus({ status: installedMod ? 'saved' : 'empty' }, installedMod)
  } catch (error) {
    modInstallStatus.textContent = describeModStatus({ status: 'error', error: error.message })
  }
}

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
globalThis.Host.Camera = cameraBridge
console.log('[bridge] global Host.Camera bridge installed')
buttonBridge.setHtmlAction('a', () => scene.setLookAround(!scene.lookAround))
buttonBridge.setHtmlAction('b', () => scene.runServoMotion())

const wasmView = new WasmView({
  scene,
  screen,
  info,
  traceLog,
  modStorage,
  onModInstallStatus: (result, installedMod) => {
    modInstallStatus.textContent = describeModStatus(result, installedMod)
  },
})
globalThis.gxView = wasmView
console.log('[bridge] global gxView installed')
refreshSavedModStatus().finally(() => wasmView.start())

modArchiveInput.addEventListener('change', async (event) => {
  const input = event.currentTarget
  const file = input.files?.[0]
  if (!file) return
  try {
    const bytes = new Uint8Array(await file.arrayBuffer())
    const installedMod = await modStorage.saveInstalledMod({ name: file.name, bytes })
    modInstallStatus.textContent = `${describeModStatus(
      { status: 'saved' },
      installedMod
    )}; ${describeModLaunchInstruction(installedMod)}`
  } catch (error) {
    console.error('[bridge] MOD archive save failed', error)
    modInstallStatus.textContent = describeModStatus({ status: 'error', error: error.message })
  } finally {
    input.value = ''
  }
})
modRestartButton.addEventListener('click', async () => {
  try {
    modInstallStatus.textContent = 'MOD: restarting simulator...'
    await wasmView.restart()
  } catch (error) {
    console.error('[bridge] simulator restart failed', error)
    modInstallStatus.textContent = describeModStatus({ status: 'error', error: error.message })
  }
})
modClearButton.addEventListener('click', async () => {
  try {
    await modStorage.clearInstalledMod()
    modInstallStatus.textContent = describeModStatus({ status: 'empty' })
  } catch (error) {
    console.error('[bridge] MOD archive clear failed', error)
    modInstallStatus.textContent = describeModStatus({ status: 'error', error: error.message })
  }
})
bindViewportScreenTouches({ viewport, scene, wasmView })

function animate(timeMs) {
  wasmView.idle(timeMs)
  scene.render(timeMs)
  window.requestAnimationFrame(animate)
}

window.requestAnimationFrame(animate)

function bindViewportScreenTouches({ viewport, scene, wasmView }) {
  const touchId = 0
  let activePointerId = undefined
  let lastPoint = undefined

  const consume = (event) => {
    event.preventDefault()
    event.stopImmediatePropagation()
  }

  const finish = (event, kind) => {
    if (event.pointerId !== activePointerId) return
    consume(event)
    if (lastPoint) {
      wasmView.touchScreenPoint(kind, touchId, lastPoint.x, lastPoint.y, event.timeStamp)
    }
    try {
      viewport.releasePointerCapture(event.pointerId)
    } catch {
      // The browser may already have released capture after cancellation.
    }
    activePointerId = undefined
    lastPoint = undefined
    scene.setViewportControlsEnabled(true)
  }

  viewport.addEventListener(
    'pointerdown',
    (event) => {
      if (activePointerId !== undefined) return
      const point = scene.screenPointFromViewportEvent(event)
      if (!point) return
      consume(event)
      activePointerId = event.pointerId
      lastPoint = point
      scene.setViewportControlsEnabled(false)
      viewport.setPointerCapture(event.pointerId)
      wasmView.touchScreenPoint(0, touchId, point.x, point.y, event.timeStamp)
    },
    { capture: true }
  )
  viewport.addEventListener(
    'pointermove',
    (event) => {
      if (event.pointerId !== activePointerId) return
      consume(event)
      const point = scene.screenPointFromViewportEvent(event)
      if (!point) return
      lastPoint = point
      wasmView.touchScreenPoint(3, touchId, point.x, point.y, event.timeStamp)
    },
    { capture: true }
  )
  viewport.addEventListener('pointerup', (event) => finish(event, 2), { capture: true })
  viewport.addEventListener('pointercancel', (event) => finish(event, 1), { capture: true })
}
