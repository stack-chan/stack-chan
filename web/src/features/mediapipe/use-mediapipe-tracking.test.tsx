import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useMediaPipeTracking, type MediaPipeTrackingDependencies } from './use-mediapipe-tracking'
import { describe, expect, it, vi } from 'vitest'

function Harness({ dependencies }: { dependencies: MediaPipeTrackingDependencies }) {
  const tracking = useMediaPipeTracking(dependencies)
  return (
    <>
      <video ref={tracking.videoRef} />
      <canvas ref={tracking.canvasRef} />
      <button type="button" onClick={() => void tracking.startCamera()}>
        start camera
      </button>
      <button type="button" onClick={tracking.stopCamera}>
        stop camera
      </button>
      <button type="button" onClick={() => void tracking.connectBle()}>
        connect ble
      </button>
      <button type="button" onClick={tracking.disconnectBle}>
        disconnect ble
      </button>
      <output data-testid="camera-status">{tracking.cameraStatus.message}</output>
      <output data-testid="ble-status">{tracking.bleStatus.message}</output>
      <output data-testid="camera-active">{String(tracking.cameraActive)}</output>
      <output data-testid="ble-connected">{String(tracking.bleConnected)}</output>
    </>
  )
}

function createDependencies() {
  const cameraTrack = { stop: vi.fn() }
  const stream = { getTracks: () => [cameraTrack] } as unknown as MediaStream
  const faceClose = vi.fn()
  const handsClose = vi.fn()
  const session = {
    closed: false,
    discover: vi.fn(async () => [{ name: 'Stack-chan test' }]),
    broadcast: vi.fn(async () => ({})),
    close: vi.fn(),
  }
  const sender = {
    queue: vi.fn(),
    flush: vi.fn(async () => false),
    clear: vi.fn(),
  }
  const dependencies = {
    cameraSupported: () => true,
    bluetoothSupported: () => true,
    getUserMedia: vi.fn(async () => stream),
    loadRuntime: vi.fn(async () => ({
      face: { detectForVideo: () => ({}), close: faceClose },
      hands: { detectForVideo: () => ({}), close: handsClose },
      DrawingUtils: class {
        drawConnectors() {}
        drawLandmarks() {}
      },
      FaceLandmarker: { FACE_LANDMARKS_FACE_OVAL: [] },
      HandLandmarker: { HAND_CONNECTIONS: [] },
    })),
    createStateBuilder: () => ({
      build: () => ({ version: 4, face: null, hands: { left: null, right: null } }),
    }),
    openBleSession: vi.fn(async () => session),
    createSender: vi.fn(() => sender),
    requestFrame: vi.fn(() => 17),
    cancelFrame: vi.fn(),
    setTimer: vi.fn(() => 31),
    clearTimer: vi.fn(),
    now: () => 100,
    sendIntervalMs: 100,
  } satisfies MediaPipeTrackingDependencies
  return { cameraTrack, dependencies, faceClose, handsClose, sender, session }
}

describe('useMediaPipeTracking', () => {
  it('owns the camera stream and MediaPipe runtime lifecycle', async () => {
    const context = { clearRect: vi.fn() } as unknown as CanvasRenderingContext2D
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context)
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
    vi.spyOn(HTMLVideoElement.prototype, 'videoWidth', 'get').mockReturnValue(1280)
    vi.spyOn(HTMLVideoElement.prototype, 'videoHeight', 'get').mockReturnValue(720)
    const { cameraTrack, dependencies, faceClose, handsClose } = createDependencies()
    const { unmount } = render(<Harness dependencies={dependencies} />)

    fireEvent.click(screen.getByRole('button', { name: 'start camera' }))
    await waitFor(() => expect(screen.getByTestId('camera-status')).toHaveTextContent('カメラ接続済み'))
    expect(screen.getByTestId('camera-active')).toHaveTextContent('true')
    expect(dependencies.loadRuntime).toHaveBeenCalledOnce()
    expect(dependencies.getUserMedia).toHaveBeenCalledWith({
      audio: false,
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
    })
    expect(dependencies.requestFrame).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole('button', { name: 'stop camera' }))
    expect(cameraTrack.stop).toHaveBeenCalledOnce()
    expect(dependencies.cancelFrame).toHaveBeenCalledWith(17)
    expect(screen.getByTestId('camera-active')).toHaveTextContent('false')
    expect(screen.getByTestId('camera-status')).toHaveTextContent('未接続')

    unmount()
    expect(faceClose).toHaveBeenCalledOnce()
    expect(handsClose).toHaveBeenCalledOnce()
  })

  it('owns BLE discovery, sender timer, and disconnect cleanup', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      clearRect: vi.fn(),
    } as unknown as CanvasRenderingContext2D)
    const { dependencies, sender, session } = createDependencies()
    render(<Harness dependencies={dependencies} />)

    fireEvent.click(screen.getByRole('button', { name: 'connect ble' }))
    await waitFor(() => expect(screen.getByTestId('ble-status')).toHaveTextContent('{peer}へ接続済み'))
    expect(screen.getByTestId('ble-connected')).toHaveTextContent('true')
    expect(dependencies.openBleSession).toHaveBeenCalledWith({
      transport: 'ble',
      service: 'tech.stackchan.demos.mediapipe',
      displayName: 'browser-mediapipe',
    })
    expect(session.discover).toHaveBeenCalledWith({ timeoutMs: 900 })
    expect(dependencies.setTimer).toHaveBeenCalledWith(expect.any(Function), 100)

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'disconnect ble' }))
    })
    expect(dependencies.clearTimer).toHaveBeenCalledWith(31)
    expect(sender.clear).toHaveBeenCalledOnce()
    expect(session.close).toHaveBeenCalledOnce()
    expect(screen.getByTestId('ble-connected')).toHaveTextContent('false')
    expect(screen.getByTestId('ble-status')).toHaveTextContent('未接続')
  })
})
