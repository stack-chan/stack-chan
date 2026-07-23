import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { STLLoader } from 'three/addons/loaders/STLLoader.js'

import {
  clientPointFromTouch,
  createHostAudioInBridge,
  createHostAudioOutBridge,
  createHostButtonBridge,
  createHostCameraBridge,
  createHostDriverBridge,
  installModArchiveIntoWasm,
  summarizeImageData,
} from '../../../simulator/bridge.mjs'
import {
  SCREEN_CANVAS,
  STACKCHAN_FACE_MM,
  STACKCHAN_FOOT_MM,
  STACKCHAN_SIMULATOR_COLORS,
  STACKCHAN_SHELL_STL,
  computeFaceLayerDepths,
  computeFaceModulePlacement,
  computeFootPlacements,
  computeGeometryTuning,
  computeScreenFrame,
  computeScreenPlane,
  computeShellPlacementFromBounds,
  computeStackchanKinematics,
  createRoundedRectPath,
  screenPointFromUv,
  stepRotationToward,
} from '../../../simulator/geometry.mjs'
import { createModStorage } from '../../../simulator/mod-storage.mjs'

const DRIVER_MAX_ANGULAR_SPEED = 2.4

class StackchanScene {
  constructor({ viewport, screen }) {
    this.viewport = viewport
    this.screen = screen
    this.driverRotation = { y: 0, p: 0, r: 0 }
    this.targetDriverRotation = { y: 0, p: 0, r: 0 }
    this.lastDriverUpdateMs = undefined
    this.torqueEnabled = true
    this.geometryTuning = computeGeometryTuning()
    this.raycaster = new THREE.Raycaster()
    this.pointerNdc = new THREE.Vector2()

    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(0x10141c)
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.1, 1000)
    this.camera.position.set(42, 28, 155)

    this.renderer = new THREE.WebGLRenderer({
      canvas: viewport,
      antialias: true,
      alpha: false,
    })
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
    this.resizeTarget = this.viewport.parentElement ?? this.viewport
    this.resizeObserver = new ResizeObserver(() => this.#resize())
    this.resizeObserver.observe(this.resizeTarget)
  }

  dispose() {
    this.resizeObserver?.disconnect()
    this.controls?.dispose()
    this.renderer?.dispose()
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
        const placement = computeShellPlacementFromBounds(STACKCHAN_SHELL_STL.sourceBoundsMm, {
          tuning: this.geometryTuning,
        })
        this.shell = new THREE.Mesh(geometry, this.shellMaterial)
        this.shell.position.set(placement.position.x, placement.position.y, placement.position.z)
        this.shell.rotation.set(placement.rotation.x, placement.rotation.y, placement.rotation.z)
        this.shell.scale.setScalar(placement.scale)
        this.headGroup.add(this.shell)

        const outline = new THREE.LineSegments(
          new THREE.EdgesGeometry(geometry, 24),
          new THREE.LineBasicMaterial({
            color: 0x3d3128,
            transparent: true,
            opacity: 0.1,
          })
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

    const layers = computeFaceLayerDepths()
    const frontPanelGeometry = new THREE.ShapeGeometry(shape)
    frontPanelGeometry.translate(0, 0, layers.frontPanelZ)
    this.faceFrontPanel = new THREE.Mesh(frontPanelGeometry, this.m5stackFrontMaterial)
    this.headGroup.add(this.faceFrontPanel)

    const outline = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry, 24),
      new THREE.LineBasicMaterial({
        color: 0x3d3128,
        transparent: true,
        opacity: 0.18,
      })
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

    for (const placement of computeFootPlacements({
      tuning: this.geometryTuning,
    })) {
      const foot = new THREE.Mesh(geometry, this.footMaterial)
      foot.position.set(placement.x, placement.y, placement.z)
      this.feetGroup.add(foot)

      const outline = new THREE.LineSegments(
        outlineGeometry,
        new THREE.LineBasicMaterial({
          color: 0x3d3128,
          transparent: true,
          opacity: 0.16,
        })
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
    const material = new THREE.MeshBasicMaterial({
      map: this.screenTexture,
      toneMapped: false,
    })
    this.screenMesh = new THREE.Mesh(geometry, material)
    this.screenMesh.position.set(plane.x, plane.y, plane.z)
    this.headGroup.add(this.screenMesh)

    const framePlacement = computeScreenFrame({ margin: 5, border: 1.2 })
    const frameShape = new THREE.Shape()
    const outerHalfWidth = framePlacement.outer.width / 2
    const outerHalfHeight = framePlacement.outer.height / 2
    frameShape.moveTo(-outerHalfWidth, -outerHalfHeight)
    frameShape.lineTo(outerHalfWidth, -outerHalfHeight)
    frameShape.lineTo(outerHalfWidth, outerHalfHeight)
    frameShape.lineTo(-outerHalfWidth, outerHalfHeight)
    frameShape.closePath()

    const screenHole = new THREE.Path()
    const innerHalfWidth = framePlacement.inner.width / 2
    const innerHalfHeight = framePlacement.inner.height / 2
    screenHole.moveTo(-innerHalfWidth, -innerHalfHeight)
    screenHole.lineTo(-innerHalfWidth, innerHalfHeight)
    screenHole.lineTo(innerHalfWidth, innerHalfHeight)
    screenHole.lineTo(innerHalfWidth, -innerHalfHeight)
    screenHole.closePath()
    frameShape.holes.push(screenHole)

    const frame = new THREE.Mesh(new THREE.ShapeGeometry(frameShape), new THREE.MeshBasicMaterial({ color: 0x211a17 }))
    frame.position.set(framePlacement.x, framePlacement.y, framePlacement.z)
    this.headGroup.add(frame)
    this.screenMesh.renderOrder = 1
  }

  #resize() {
    const { width, height } = this.resizeTarget?.getBoundingClientRect() ?? this.viewport.getBoundingClientRect()
    if (width <= 0 || height <= 0) return
    this.renderer.setSize(width, height, false)
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
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
    return screenPointFromUv(hit?.uv, {
      width: this.screen.width,
      height: this.screen.height,
    })
  }

  render(timeMs) {
    this.updateDriverRotation(timeMs)
    const transforms = computeStackchanKinematics(timeMs, {
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
  constructor({
    scene,
    screen,
    modStorage,
    onStatus = () => {},
    onTrace = () => {},
    onNotify = () => {},
    onModInstallStatus = () => {},
    onReady = () => {},
    onError = () => {},
  }) {
    this.scene = scene
    this.screen = screen
    this.modStorage = modStorage
    this.onStatus = onStatus
    this.onTrace = onTrace
    this.onNotify = onNotify
    this.onModInstallStatus = onModInstallStatus
    this.onReady = onReady
    this.onError = onError
    this.runCount = 0
    this.interval = 0
    this.tracking = 0
    this.when = 0
    this.image = null
    this.bufferChangeCount = 0
    this.pendingReadyInstallation = null
    this.readyTimeout = 0

    this.#bindTouches()
  }

  start() {
    return this.#loadWasm()
  }

  #bindTouches() {
    this.touchHandlers = {
      mousedown: (event) => this.#mouse(event, 0),
      mousemove: (event) => this.tracking && this.#mouse(event, 3),
      mouseup: (event) => this.#mouse(event, 2),
      touchstart: (event) => this.#touches(event, 0),
      touchmove: (event) => this.#touches(event, 3),
      touchend: (event) => this.#touches(event, 2),
      touchcancel: (event) => this.#touches(event, 1),
    }
    this.screen.addEventListener('mousedown', this.touchHandlers.mousedown)
    this.screen.addEventListener('mousemove', this.touchHandlers.mousemove)
    this.screen.addEventListener('mouseup', this.touchHandlers.mouseup)
    this.screen.addEventListener('touchstart', this.touchHandlers.touchstart, { passive: false })
    this.screen.addEventListener('touchmove', this.touchHandlers.touchmove, { passive: false })
    this.screen.addEventListener('touchend', this.touchHandlers.touchend, { passive: false })
    this.screen.addEventListener('touchcancel', this.touchHandlers.touchcancel, { passive: false })
  }

  dispose() {
    this.disposed = true
    this.#clearPendingReady()
    this.fxMainQuit?.()
    for (const [eventName, handler] of Object.entries(this.touchHandlers ?? {})) {
      this.screen.removeEventListener(eventName, handler)
    }
  }

  async #loadWasm() {
    try {
      console.log('[bridge] importing mc.js')
      const wasmCacheKey = Date.now()
      const moduleUrl = new URL('./mc.js', document.baseURI)
      moduleUrl.searchParams.set('v', String(wasmCacheKey))
      const ns = await import(/* @vite-ignore */ moduleUrl.href)
      this.mc = await ns.default({
        locateFile: () => {
          const wasmUrl = new URL('./mc.wasm', document.baseURI)
          wasmUrl.searchParams.set('v', String(wasmCacheKey))
          return wasmUrl.href
        },
        print: (text) => this.#handleFirmwarePrint(text),
        printErr: (text) => this.#handleFirmwareError(text),
      })
      if (this.disposed) return
      console.log('[bridge] mc.js module ready')
      this.fxMainIdle = this.mc._fxMainIdle
      this.fxMainLaunch = this.mc._fxMainLaunch
      this.fxMainQuit = this.mc._fxMainQuit
      this.fxMainTouch = this.mc._fxMainTouch
      const installation = await this.installSavedModArchive()
      this.#awaitFirmwareReady(installation.result)
      this.launch(installation.pointer)
    } catch (error) {
      this.#clearPendingReady()
      console.error('[bridge] WASM load failed', error)
      this.onStatus({ status: 'error', message: 'WASMを読み込めませんでした' })
      this.#drawFallbackFace()
      this.onError(error)
    }
  }

  async installSavedModArchive() {
    try {
      const installedMod = await this.modStorage.loadInstalledMod()
      const result = installModArchiveIntoWasm(this.mc, installedMod)
      console.log('[bridge] MOD archive install', result)
      this.onModInstallStatus(result, installedMod)
      if (installedMod && result.status !== 'prepared' && result.status !== 'installed') {
        throw new Error(`MODアーカイブを起動できません (${result.status})`)
      }
      return { pointer: result.pointer ?? undefined, result }
    } catch (error) {
      const result = { status: 'error', error: error.message }
      console.error('[bridge] MOD archive install failed', error)
      this.onModInstallStatus(result)
      throw error
    }
  }

  #reportReady(installation) {
    this.#clearPendingReady()
    this.runCount += 1
    this.onReady({ runCount: this.runCount, installation })
  }

  #awaitFirmwareReady(installation) {
    this.#clearPendingReady()
    this.pendingReadyInstallation = installation
    this.readyTimeout = window.setTimeout(() => {
      if (!this.pendingReadyInstallation) return
      this.#clearPendingReady()
      const error = new Error('ファームウェアの起動準備がタイムアウトしました')
      this.onStatus({ status: 'error', message: error.message })
      this.onError(error)
    }, 30_000)
  }

  #clearPendingReady() {
    if (this.readyTimeout) window.clearTimeout(this.readyTimeout)
    this.readyTimeout = 0
    this.pendingReadyInstallation = null
  }

  #handleFirmwarePrint(text) {
    this.#applyFirmwareDriverTrace(text)
    this.#appendTrace(text)
    console.log(`[firmware] ${text}`)
    if (String(text).includes('[main] app behaviors ready') && this.pendingReadyInstallation) {
      this.#reportReady(this.pendingReadyInstallation)
    }
  }

  #handleFirmwareError(text) {
    this.#appendTrace(`[err] ${text}`)
    console.error(`[firmware:err] ${text}`)
  }

  #appendTrace(text) {
    this.onTrace(String(text))
    this.onNotify({ type: 'stackchan-simulator-trace', text: String(text) })
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
    const installation = await this.installSavedModArchive()
    this.#awaitFirmwareReady(installation.result)
    try {
      this.launch(installation.pointer)
    } catch (error) {
      this.#clearPendingReady()
      throw error
    }
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
    console.log('[bridge] onFormatChanged', {
      which,
      format,
      xs: `${major}.${minor}.${patch}`,
    })
    this.onStatus({ status: 'success', message: '準備完了' })
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

function notifyHostWindow(message) {
  const target = window.opener ?? (window.parent !== window ? window.parent : null)
  target?.postMessage(message, location.origin)
}

function bindManagedViewportTouches({ viewport, scene, wasmView }) {
  const touchId = 0
  let activePointerId
  let lastPoint

  const consume = (event) => {
    event.preventDefault()
    event.stopImmediatePropagation()
  }
  const finish = (event, kind) => {
    if (event.pointerId !== activePointerId) return
    consume(event)
    if (lastPoint) wasmView.touchScreenPoint(kind, touchId, lastPoint.x, lastPoint.y, event.timeStamp)
    try {
      viewport.releasePointerCapture(event.pointerId)
    } catch {
      // Pointer capture can already be released after cancellation.
    }
    activePointerId = undefined
    lastPoint = undefined
    scene.setViewportControlsEnabled(true)
  }
  const handlers = {
    pointerdown: (event) => {
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
    pointermove: (event) => {
      if (event.pointerId !== activePointerId) return
      consume(event)
      const point = scene.screenPointFromViewportEvent(event)
      if (!point) return
      lastPoint = point
      wasmView.touchScreenPoint(3, touchId, point.x, point.y, event.timeStamp)
    },
    pointerup: (event) => finish(event, 2),
    pointercancel: (event) => finish(event, 1),
  }

  for (const [eventName, handler] of Object.entries(handlers)) {
    viewport.addEventListener(eventName, handler, { capture: true })
  }
  return () => {
    for (const [eventName, handler] of Object.entries(handlers)) {
      viewport.removeEventListener(eventName, handler, { capture: true })
    }
  }
}

export class SimulatorEngine {
  constructor({
    viewport,
    screen,
    onStatus = () => {},
    onTrace = () => {},
    onModStatus = () => {},
    onCameraStatus = () => {},
  }) {
    this.viewport = viewport
    this.screen = screen
    this.onStatus = onStatus
    this.onTrace = onTrace
    this.onModStatus = onModStatus
    this.onCameraStatus = onCameraStatus
    this.modStorage = createModStorage()
    this.buttonBridge = createHostButtonBridge({ logger: (message) => this.onTrace(message) })
    this.audioOutBridge = createHostAudioOutBridge()
    this.audioInBridge = createHostAudioInBridge()
    this.cameraBridge = createHostCameraBridge()
    this.scene = new StackchanScene({ viewport, screen })
    this.driverBridge = createHostDriverBridge({
      onRotation: (rotation) => this.scene.applyDriverRotation(rotation),
      onTorque: (torque) => this.scene.setTorqueEnabled(torque),
    })
    this.previousHost = globalThis.Host
    this.previousGxView = globalThis.gxView
    this.hostBridge = {
      Button: this.buttonBridge.Button,
      AudioOut: this.audioOutBridge,
      AudioIn: this.audioInBridge,
      Camera: this.cameraBridge,
      Driver: this.driverBridge,
    }
    globalThis.Host = this.hostBridge
    this.wasmView = new WasmView({
      scene: this.scene,
      screen,
      modStorage: this.modStorage,
      onStatus,
      onTrace,
      onNotify: notifyHostWindow,
      onModInstallStatus: onModStatus,
      onReady: ({ runCount, installation }) => {
        if (installation?.status === 'prepared') {
          this.onModStatus({ ...installation, status: 'installed' })
        }
        notifyHostWindow({
          type: 'stackchan-simulator-ready',
          runCount,
          installationStatus: installation.status,
        })
      },
      onError: (error) => {
        notifyHostWindow({
          type: 'stackchan-simulator-status',
          status: 'error',
          error: String(error.message ?? error),
        })
      },
    })
    globalThis.gxView = this.wasmView
    this.unbindViewport = bindManagedViewportTouches({
      viewport,
      scene: this.scene,
      wasmView: this.wasmView,
    })
    this.handleMessage = (event) => void this.#receiveMessage(event)
    window.addEventListener('message', this.handleMessage)
  }

  async start() {
    this.onStatus({ status: 'pending', message: 'WASMを読み込み中' })
    await this.refreshModStatus()
    await this.wasmView.start()
    if (this.disposed) return
    const animate = (timeMs) => {
      this.wasmView.idle(timeMs)
      this.scene.render(timeMs)
      this.animationFrame = window.requestAnimationFrame(animate)
    }
    this.animationFrame = window.requestAnimationFrame(animate)
  }

  async refreshModStatus() {
    try {
      const installedMod = await this.modStorage.loadInstalledMod()
      this.onModStatus({ status: installedMod ? 'saved' : 'empty' }, installedMod)
      return installedMod
    } catch (error) {
      this.onModStatus({ status: 'error', error: String(error.message ?? error) })
      return null
    }
  }

  async installMod(file) {
    const bytes = new Uint8Array(await file.arrayBuffer())
    const installedMod = await this.modStorage.saveInstalledMod({ name: file.name, bytes })
    this.onModStatus({ status: 'restarting' }, installedMod)
    await this.wasmView.restart()
  }

  async restart() {
    this.onModStatus({ status: 'restarting' })
    await this.wasmView.restart()
  }

  async clearMod() {
    await this.modStorage.clearInstalledMod()
    this.onModStatus({ status: 'empty' })
  }

  async connectCamera() {
    this.onCameraStatus({ status: 'pending' })
    try {
      await this.cameraBridge.start({ useBrowserCamera: true })
      this.onCameraStatus({
        status: this.cameraBridge.isBrowserCameraStarted() ? 'connected' : 'fallback',
      })
    } catch (error) {
      this.onCameraStatus({ status: 'error', error: String(error.message ?? error) })
      throw error
    }
  }

  pushButton(name) {
    this.buttonBridge.push(name)
  }

  async #receiveMessage(event) {
    if (event.origin !== location.origin || event.data?.type !== 'stackchan-editor-command') return
    try {
      if (event.data.command === 'restart') await this.restart()
      if (event.data.command === 'button') this.pushButton(event.data.name)
    } catch (error) {
      notifyHostWindow({
        type: 'stackchan-simulator-status',
        status: 'error',
        error: String(error.message ?? error),
      })
    }
  }

  dispose() {
    this.disposed = true
    if (this.animationFrame) window.cancelAnimationFrame(this.animationFrame)
    window.removeEventListener('message', this.handleMessage)
    this.unbindViewport?.()
    this.wasmView.dispose()
    this.scene.dispose()
    this.cameraBridge.stop()
    if (globalThis.Host === this.hostBridge && this.previousHost === undefined) {
      delete globalThis.Host
    } else if (globalThis.Host === this.hostBridge) {
      globalThis.Host = this.previousHost
    }
    if (globalThis.gxView === this.wasmView) {
      if (this.previousGxView === undefined) delete globalThis.gxView
      else globalThis.gxView = this.previousGxView
    }
  }
}
