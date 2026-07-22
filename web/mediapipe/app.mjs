import BLELocalPeerCapability from '../local-peer/ble-local-peer.mjs'
import { LatestTrackingSender } from './latest-sender.mjs'
import { loadMediaPipe } from './media-pipe.mjs'
import { TRACKING_SERVICE, TrackingStateBuilder } from './tracking.mjs'

const cameraButton = document.getElementById('camera-button')
const cameraStopButton = document.getElementById('camera-stop-button')
const bleButton = document.getElementById('ble-button')
const bleDisconnectButton = document.getElementById('ble-disconnect-button')
const cameraStatus = document.getElementById('camera-status')
const bleStatus = document.getElementById('ble-status')
const trackingStatus = document.getElementById('tracking-status')
const video = document.getElementById('camera-video')
const canvas = document.getElementById('tracking-canvas')
const context = canvas.getContext('2d')

const stateBuilder = new TrackingStateBuilder()
let mediaPipe
let stream
let animationFrame
let lastVideoTime = -1
let session
let sender
let sendTimer

function errorMessage(error) {
  return error?.message ?? String(error)
}

function setCameraStatus(message, state = 'idle') {
  cameraStatus.textContent = message
  cameraStatus.dataset.state = state
}

function setBLEStatus(message, state = 'idle') {
  bleStatus.textContent = message
  bleStatus.dataset.state = state
}

function formatHand(hand) {
  return hand
    ? `${hand.fingerCount === 3 ? '3+' : hand.fingerCount}本 (${hand.x.toFixed(2)}, ${hand.y.toFixed(2)})`
    : '未検出'
}

function renderTrackingState(value) {
  const face = value.face
  document.getElementById('face-value').textContent = face
    ? `yaw ${face.yaw.toFixed(2)} / pitch ${face.pitch.toFixed(2)}`
    : '未検出'
  document.getElementById('emotion-value').textContent = face?.emotion === 'happy' ? '笑顔' : face ? '真顔' : '未検出'
  document.getElementById('left-hand-value').textContent = formatHand(value.hands.left)
  document.getElementById('right-hand-value').textContent = formatHand(value.hands.right)
  trackingStatus.textContent =
    face || value.hands.left || value.hands.right ? '追跡中' : '顔と手をカメラに映してください'
}

function drawResults(faceResult, handResult) {
  context.clearRect(0, 0, canvas.width, canvas.height)
  const drawing = new mediaPipe.DrawingUtils(context)
  for (const landmarks of faceResult.faceLandmarks ?? []) {
    drawing.drawConnectors(landmarks, mediaPipe.FaceLandmarker.FACE_LANDMARKS_FACE_OVAL, {
      color: '#42bde8',
      lineWidth: 2,
    })
  }
  for (const landmarks of handResult.landmarks ?? []) {
    drawing.drawConnectors(landmarks, mediaPipe.HandLandmarker.HAND_CONNECTIONS, {
      color: '#83d9aa',
      lineWidth: 3,
    })
    drawing.drawLandmarks(landmarks, { color: '#f4f6f7', radius: 2 })
  }
}

function detectFrame() {
  if (!stream) return
  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime
    const timestamp = performance.now()
    try {
      const faceResult = mediaPipe.face.detectForVideo(video, timestamp)
      const handResult = mediaPipe.hands.detectForVideo(video, timestamp)
      const trackingState = stateBuilder.build(faceResult, handResult)
      renderTrackingState(trackingState)
      drawResults(faceResult, handResult)
      sender?.queue(trackingState)
    } catch (error) {
      setCameraStatus(`認識に失敗しました: ${errorMessage(error)}`, 'error')
    }
  }
  animationFrame = requestAnimationFrame(detectFrame)
}

async function startCamera() {
  cameraButton.disabled = true
  setCameraStatus('MediaPipeモデルを読み込んでいます…', 'busy')
  try {
    mediaPipe ??= await loadMediaPipe()
    setCameraStatus('カメラの許可を待っています…', 'busy')
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
    })
    video.srcObject = stream
    await video.play()
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    lastVideoTime = -1
    cameraStopButton.disabled = false
    setCameraStatus('カメラ接続済み', 'connected')
    animationFrame = requestAnimationFrame(detectFrame)
  } catch (error) {
    stopCamera()
    setCameraStatus(`カメラを開始できません: ${errorMessage(error)}`, 'error')
    cameraButton.disabled = false
  }
}

function stopCamera() {
  if (animationFrame) cancelAnimationFrame(animationFrame)
  animationFrame = undefined
  for (const track of stream?.getTracks() ?? []) track.stop()
  stream = undefined
  video.srcObject = null
  context.clearRect(0, 0, canvas.width, canvas.height)
  cameraButton.disabled = false
  cameraStopButton.disabled = true
  trackingStatus.textContent = 'カメラ停止中'
  setCameraStatus('未接続')
}

async function connectBLE() {
  bleButton.disabled = true
  setBLEStatus('デバイスを選択してください…', 'busy')
  try {
    const capability = new BLELocalPeerCapability()
    session = await capability.open({
      transport: 'ble',
      service: TRACKING_SERVICE,
      displayName: 'browser-mediapipe',
    })
    setBLEStatus('受信MODを探索しています…', 'busy')
    const peers = await session.discover({ timeoutMs: 900 })
    if (!peers[0]) throw new Error('MediaPipe受信MODが見つかりません')
    sender = new LatestTrackingSender(session, peers[0].id)
    sendTimer = setInterval(() => {
      void sender.flush().catch((error) => {
        setBLEStatus(`送信に失敗しました: ${errorMessage(error)}`, 'error')
      })
    }, 100)
    bleDisconnectButton.disabled = false
    setBLEStatus(`${peers[0].name ?? 'ｽﾀｯｸﾁｬﾝ'}へ接続済み`, 'connected')
  } catch (error) {
    disconnectBLE()
    setBLEStatus(`接続できません: ${errorMessage(error)}`, 'error')
  }
}

function disconnectBLE() {
  if (sendTimer) clearInterval(sendTimer)
  sendTimer = undefined
  sender?.clear()
  sender = undefined
  session?.close()
  session = undefined
  bleButton.disabled = !navigator.bluetooth
  bleDisconnectButton.disabled = true
  if (bleStatus.dataset.state !== 'error') setBLEStatus('未接続')
}

cameraButton.addEventListener('click', startCamera)
cameraStopButton.addEventListener('click', stopCamera)
bleButton.addEventListener('click', connectBLE)
bleDisconnectButton.addEventListener('click', disconnectBLE)
window.addEventListener('pagehide', () => {
  stopCamera()
  disconnectBLE()
  mediaPipe?.face.close()
  mediaPipe?.hands.close()
})

if (!navigator.mediaDevices?.getUserMedia) {
  cameraButton.disabled = true
  setCameraStatus('このブラウザではカメラを利用できません', 'error')
}
if (!navigator.bluetooth) {
  bleButton.disabled = true
  setBLEStatus('Web Bluetooth対応のChromeまたはEdgeが必要です', 'error')
}
