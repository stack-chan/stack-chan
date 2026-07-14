import { FACE_ASSET_MEDIA_TYPE, createFaceAsset } from '../editor/face-assets.mjs'

const elements = {
  name: document.getElementById('face-name'),
  emotion: document.getElementById('face-emotion'),
  primary: document.getElementById('primary-color'),
  secondary: document.getElementById('secondary-color'),
  mouth: document.getElementById('mouth-open'),
  canvas: document.getElementById('face-canvas'),
  mouthPreview: document.getElementById('mouth'),
  status: document.getElementById('face-status'),
}

function currentAsset() {
  return createFaceAsset({
    name: elements.name.value,
    emotion: elements.emotion.value,
    primary: elements.primary.value,
    secondary: elements.secondary.value,
    mouth: elements.mouth.value,
  })
}

function render() {
  const asset = currentAsset()
  elements.canvas.style.color = asset.colors.primary
  elements.canvas.style.background = asset.colors.secondary
  elements.mouthPreview.style.height = `${Math.max(1, asset.mouth * 18)}%`
  elements.canvas.dataset.emotion = asset.emotion
}

document.getElementById('face-form').addEventListener('input', render)
document.getElementById('download-face').addEventListener('click', () => {
  const asset = currentAsset()
  const blob = new Blob([`${JSON.stringify(asset, null, 2)}\n`], { type: FACE_ASSET_MEDIA_TYPE })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${asset.name.replace(/[^\p{L}\p{N}._-]/gu, '_')}.stackchan-face.json`
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
})
document.getElementById('send-to-editor').addEventListener('click', () => {
  localStorage.setItem('stackchan-face-asset-staging', JSON.stringify(currentAsset()))
  elements.status.textContent = '顔アセットを保存しました。ブロックエディタを開きます。'
  location.href = '../editor/?face-asset=staging'
})
render()
