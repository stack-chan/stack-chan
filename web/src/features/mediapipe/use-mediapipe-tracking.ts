import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

import BLELocalPeerCapability from '../../../local-peer/ble-local-peer.mjs'
import { LatestTrackingSender, TRACKING_SEND_INTERVAL_MS } from '../../../mediapipe/latest-sender.mjs'
import { loadMediaPipe } from '../../../mediapipe/media-pipe.mjs'
import { TRACKING_SERVICE, TrackingStateBuilder } from '../../../mediapipe/tracking.mjs'

export type TrackingHand = {
  x: number
  y: number
  fingerCount: number
  variant: number
}

export type TrackingFace = {
  yaw: number
  pitch: number
  emotion: 'happy' | 'neutral'
  eyeOpen?: {
    left: number
    right: number
  }
  mouthOpen?: number
}

export type TrackingState = {
  version: number
  face: TrackingFace | null
  hands: {
    left: TrackingHand | null
    right: TrackingHand | null
  }
}

export type TrackingActivityStatus = {
  state: 'idle' | 'busy' | 'connected' | 'error'
  message: string
  params?: Record<string, unknown>
}

type FaceResult = {
  faceLandmarks?: readonly unknown[]
}

type HandResult = {
  landmarks?: readonly unknown[]
}

type MediaPipeRuntime = {
  face: {
    detectForVideo: (video: HTMLVideoElement, timestamp: number) => FaceResult
    close: () => void
  }
  hands: {
    detectForVideo: (video: HTMLVideoElement, timestamp: number) => HandResult
    close: () => void
  }
  DrawingUtils: new (context: CanvasRenderingContext2D) => {
    drawConnectors: (landmarks: unknown, connectors: unknown, options: Record<string, unknown>) => void
    drawLandmarks: (landmarks: unknown, options: Record<string, unknown>) => void
  }
  FaceLandmarker: {
    FACE_LANDMARKS_FACE_OVAL: unknown
  }
  HandLandmarker: {
    HAND_CONNECTIONS: unknown
  }
}

type TrackingStateBuilderLike = {
  build: (faceResult: FaceResult, handResult: HandResult) => TrackingState
}

type BlePeer = {
  name?: string
}

type BleSession = {
  closed: boolean
  discover: (options: { timeoutMs: number }) => Promise<BlePeer[]>
  broadcast: (type: string, payload: unknown) => Promise<unknown>
  close: () => void
}

type TrackingSender = {
  queue: (value: TrackingState) => void
  flush: () => Promise<boolean>
  clear: () => void
}

type BleSessionOptions = {
  transport: 'ble'
  service: string
  displayName: string
}

type BluetoothNavigator = Navigator & {
  bluetooth?: unknown
}

export type MediaPipeTrackingDependencies = {
  cameraSupported: () => boolean
  bluetoothSupported: () => boolean
  getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>
  loadRuntime: () => Promise<MediaPipeRuntime>
  createStateBuilder: () => TrackingStateBuilderLike
  openBleSession: (options: BleSessionOptions) => Promise<BleSession>
  createSender: (session: BleSession) => TrackingSender
  requestFrame: (callback: FrameRequestCallback) => number
  cancelFrame: (handle: number) => void
  setTimer: (callback: () => void, delay: number) => number
  clearTimer: (handle: number) => void
  now: () => number
  sendIntervalMs: number
}

const DEFAULT_DEPENDENCIES: MediaPipeTrackingDependencies = {
  cameraSupported: () => Boolean(navigator.mediaDevices?.getUserMedia),
  bluetoothSupported: () => Boolean((navigator as BluetoothNavigator).bluetooth),
  getUserMedia: (constraints) => navigator.mediaDevices.getUserMedia(constraints),
  loadRuntime: () => loadMediaPipe() as Promise<MediaPipeRuntime>,
  createStateBuilder: () => new TrackingStateBuilder() as TrackingStateBuilderLike,
  openBleSession: async (options) => {
    const capability = new BLELocalPeerCapability()
    return capability.open(options) as Promise<BleSession>
  },
  createSender: (session) => new LatestTrackingSender(session) as TrackingSender,
  requestFrame: (callback) => window.requestAnimationFrame(callback),
  cancelFrame: (handle) => window.cancelAnimationFrame(handle),
  setTimer: (callback, delay) => window.setInterval(callback, delay),
  clearTimer: (handle) => window.clearInterval(handle),
  now: () => performance.now(),
  sendIntervalMs: TRACKING_SEND_INTERVAL_MS,
}

const EMPTY_TRACKING_STATE: TrackingState = {
  version: 0,
  face: null,
  hands: { left: null, right: null },
}

type Resources = {
  stateBuilder: TrackingStateBuilderLike
  runtime?: MediaPipeRuntime
  stream?: MediaStream
  animationFrame?: number
  lastVideoTime: number
  cameraRequest: number
  cameraStarting: boolean
  bleRequest: number
  bleConnecting: boolean
  session?: BleSession
  sender?: TrackingSender
  sendTimer?: number
  peerName?: string
}

export type MediaPipeTracking = {
  videoRef: RefObject<HTMLVideoElement | null>
  canvasRef: RefObject<HTMLCanvasElement | null>
  cameraSupported: boolean
  bluetoothSupported: boolean
  cameraActive: boolean
  bleConnected: boolean
  cameraStatus: TrackingActivityStatus
  bleStatus: TrackingActivityStatus
  trackingStatus: string
  trackingState: TrackingState
  startCamera: () => Promise<void>
  stopCamera: () => void
  connectBle: () => Promise<void>
  disconnectBle: () => void
}

const idleStatus = (): TrackingActivityStatus => ({ state: 'idle', message: '未接続' })

const errorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message
  return String(error)
}

export function useMediaPipeTracking(
  dependencyOverrides: Partial<MediaPipeTrackingDependencies> = {}
): MediaPipeTracking {
  const dependencies = useRef({ ...DEFAULT_DEPENDENCIES, ...dependencyOverrides }).current
  const cameraSupported = useRef(dependencies.cameraSupported()).current
  const bluetoothSupported = useRef(dependencies.bluetoothSupported()).current
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const mounted = useRef(true)
  const resources = useRef<Resources>({
    stateBuilder: dependencies.createStateBuilder(),
    lastVideoTime: -1,
    cameraRequest: 0,
    cameraStarting: false,
    bleRequest: 0,
    bleConnecting: false,
  })
  const [cameraActive, setCameraActive] = useState(false)
  const [bleConnected, setBleConnected] = useState(false)
  const [trackingState, setTrackingState] = useState<TrackingState>(EMPTY_TRACKING_STATE)
  const [trackingStatus, setTrackingStatus] = useState('カメラ停止中')
  const [cameraStatus, setCameraStatus] = useState<TrackingActivityStatus>(() =>
    cameraSupported ? idleStatus() : { state: 'error', message: 'このブラウザではカメラを利用できません' }
  )
  const [bleStatus, setBleStatus] = useState<TrackingActivityStatus>(() =>
    bluetoothSupported ? idleStatus() : { state: 'error', message: 'Web Bluetooth対応のChromeまたはEdgeが必要です' }
  )
  const cameraRestingStatus = useCallback(
    (): TrackingActivityStatus =>
      cameraSupported ? idleStatus() : { state: 'error', message: 'このブラウザではカメラを利用できません' },
    [cameraSupported]
  )
  const bleRestingStatus = useCallback(
    (): TrackingActivityStatus =>
      bluetoothSupported ? idleStatus() : { state: 'error', message: 'Web Bluetooth対応のChromeまたはEdgeが必要です' },
    [bluetoothSupported]
  )

  const releaseCamera = useCallback(
    (nextStatus?: TrackingActivityStatus) => {
      const current = resources.current
      current.cameraRequest += 1
      current.cameraStarting = false
      if (current.animationFrame !== undefined) dependencies.cancelFrame(current.animationFrame)
      current.animationFrame = undefined
      for (const track of current.stream?.getTracks() ?? []) track.stop()
      current.stream = undefined
      current.lastVideoTime = -1

      const video = videoRef.current
      if (video) video.srcObject = null
      const canvas = canvasRef.current
      canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height)

      if (!mounted.current || !nextStatus) return
      setCameraActive(false)
      setTrackingState(EMPTY_TRACKING_STATE)
      setTrackingStatus('カメラ停止中')
      setCameraStatus(nextStatus)
    },
    [dependencies]
  )

  const stopCamera = useCallback(() => {
    releaseCamera(cameraRestingStatus())
  }, [cameraRestingStatus, releaseCamera])

  const startCamera = useCallback(async () => {
    const current = resources.current
    if (!cameraSupported || current.cameraStarting || current.stream) return
    const request = ++current.cameraRequest
    current.cameraStarting = true
    setCameraStatus({ state: 'busy', message: 'MediaPipeモデルを読み込んでいます…' })

    try {
      let runtime = current.runtime
      if (!runtime) {
        const loaded = await dependencies.loadRuntime()
        if (!mounted.current || resources.current.cameraRequest !== request) {
          loaded.face.close()
          loaded.hands.close()
          return
        }
        resources.current.runtime = loaded
        runtime = loaded
      }

      setCameraStatus({ state: 'busy', message: 'カメラの許可を待っています…' })
      const stream = await dependencies.getUserMedia({
        audio: false,
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
      })
      if (!mounted.current || resources.current.cameraRequest !== request) {
        for (const track of stream.getTracks()) track.stop()
        return
      }
      resources.current.stream = stream

      const video = videoRef.current
      const canvas = canvasRef.current
      const context = canvas?.getContext('2d')
      if (!video || !canvas || !context) throw new Error('カメラ表示を初期化できません')

      video.srcObject = stream
      await video.play()
      if (!mounted.current || resources.current.cameraRequest !== request) return
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      resources.current.lastVideoTime = -1
      const drawing = new runtime.DrawingUtils(context)

      const detectFrame = () => {
        const active = resources.current
        if (!mounted.current || active.stream !== stream || active.runtime !== runtime) return
        if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.currentTime !== active.lastVideoTime) {
          active.lastVideoTime = video.currentTime
          try {
            const timestamp = dependencies.now()
            const faceResult = runtime.face.detectForVideo(video, timestamp)
            const handResult = runtime.hands.detectForVideo(video, timestamp)
            const value = active.stateBuilder.build(faceResult, handResult)
            setTrackingState(value)
            setTrackingStatus(
              value.face || value.hands.left || value.hands.right ? '追跡中' : '顔と手をカメラに映してください'
            )
            context.clearRect(0, 0, canvas.width, canvas.height)
            for (const landmarks of faceResult.faceLandmarks ?? []) {
              drawing.drawConnectors(landmarks, runtime.FaceLandmarker.FACE_LANDMARKS_FACE_OVAL, {
                color: '#42bde8',
                lineWidth: 2,
              })
            }
            for (const landmarks of handResult.landmarks ?? []) {
              drawing.drawConnectors(landmarks, runtime.HandLandmarker.HAND_CONNECTIONS, {
                color: '#83d9aa',
                lineWidth: 3,
              })
              drawing.drawLandmarks(landmarks, { color: '#f4f6f7', radius: 2 })
            }
            active.sender?.queue(value)
          } catch (error) {
            setCameraStatus({
              state: 'error',
              message: '認識に失敗しました: {error}',
              params: { error: errorMessage(error) },
            })
          }
        }
        active.animationFrame = dependencies.requestFrame(detectFrame)
      }

      setCameraActive(true)
      setCameraStatus({ state: 'connected', message: 'カメラ接続済み' })
      resources.current.animationFrame = dependencies.requestFrame(detectFrame)
    } catch (error) {
      if (resources.current.cameraRequest !== request) return
      releaseCamera({
        state: 'error',
        message: 'カメラを開始できません: {error}',
        params: { error: errorMessage(error) },
      })
    } finally {
      if (resources.current.cameraRequest === request) resources.current.cameraStarting = false
    }
  }, [cameraSupported, dependencies, releaseCamera])

  const releaseBle = useCallback(
    (nextStatus?: TrackingActivityStatus) => {
      const current = resources.current
      current.bleRequest += 1
      current.bleConnecting = false
      if (current.sendTimer !== undefined) dependencies.clearTimer(current.sendTimer)
      current.sendTimer = undefined
      current.sender?.clear()
      current.sender = undefined
      current.session?.close()
      current.session = undefined
      current.peerName = undefined
      if (!mounted.current || !nextStatus) return
      setBleConnected(false)
      setBleStatus(nextStatus)
    },
    [dependencies]
  )

  const disconnectBle = useCallback(() => {
    releaseBle(bleRestingStatus())
  }, [bleRestingStatus, releaseBle])

  const connectBle = useCallback(async () => {
    const current = resources.current
    if (!bluetoothSupported || current.bleConnecting || (current.session && !current.session.closed)) return
    const request = ++current.bleRequest
    current.bleConnecting = true
    setBleStatus({ state: 'busy', message: 'デバイスを選択してください…' })

    try {
      const session = await dependencies.openBleSession({
        transport: 'ble',
        service: TRACKING_SERVICE,
        displayName: 'browser-mediapipe',
      })
      if (!mounted.current || resources.current.bleRequest !== request) {
        session.close()
        return
      }
      resources.current.session = session
      setBleStatus({ state: 'busy', message: '受信MODを探索しています…' })
      const peers = await session.discover({ timeoutMs: 900 })
      if (!mounted.current || resources.current.bleRequest !== request) {
        session.close()
        return
      }
      if (!peers[0]) throw new Error('MediaPipe受信MODが見つかりません')

      const peerName = peers[0].name ?? 'ｽﾀｯｸﾁｬﾝ'
      const sender = dependencies.createSender(session)
      resources.current.sender = sender
      resources.current.peerName = peerName
      resources.current.sendTimer = dependencies.setTimer(() => {
        const active = resources.current
        if (active.sender !== sender || active.session !== session) return
        void sender
          .flush()
          .then((sent) => {
            if (!mounted.current || resources.current.sender !== sender || !sent) return
            setBleStatus({ state: 'connected', message: '{peer}へ接続済み', params: { peer: peerName } })
          })
          .catch((error) => {
            if (!mounted.current || resources.current.sender !== sender) return
            if (session.closed) {
              releaseBle()
              setBleStatus({
                state: 'error',
                message: '接続が切れました: {error}。再接続してください',
                params: { error: errorMessage(error) },
              })
            } else {
              setBleStatus({
                state: 'busy',
                message: '一時的に送信できません: {error}。再試行中です',
                params: { error: errorMessage(error) },
              })
            }
          })
      }, dependencies.sendIntervalMs)
      setBleConnected(true)
      setBleStatus({ state: 'connected', message: '{peer}へ接続済み', params: { peer: peerName } })
    } catch (error) {
      if (resources.current.bleRequest !== request) return
      releaseBle()
      setBleStatus({
        state: 'error',
        message: '接続できません: {error}',
        params: { error: errorMessage(error) },
      })
    } finally {
      if (resources.current.bleRequest === request) resources.current.bleConnecting = false
    }
  }, [bluetoothSupported, dependencies, releaseBle])

  useEffect(() => {
    mounted.current = true
    const releaseAll = (updateState: boolean) => {
      releaseCamera(updateState ? cameraRestingStatus() : undefined)
      releaseBle(updateState ? bleRestingStatus() : undefined)
      const runtime = resources.current.runtime
      resources.current.runtime = undefined
      runtime?.face.close()
      runtime?.hands.close()
    }
    const handlePageHide = () => releaseAll(true)
    window.addEventListener('pagehide', handlePageHide)
    return () => {
      mounted.current = false
      window.removeEventListener('pagehide', handlePageHide)
      releaseAll(false)
    }
  }, [bleRestingStatus, cameraRestingStatus, releaseBle, releaseCamera])

  return {
    videoRef,
    canvasRef,
    cameraSupported,
    bluetoothSupported,
    cameraActive,
    bleConnected,
    cameraStatus,
    bleStatus,
    trackingStatus,
    trackingState,
    startCamera,
    stopCamera,
    connectBle,
    disconnectBle,
  }
}
