import { FACE_ASSET_MEDIA_TYPE, createFaceAsset, parseFaceAsset, shapeFaceDefinition } from '../editor/face-assets.mjs'

const element = (id) => document.getElementById(id)
const elements = {
  form: element('face-form'),
  name: element('face-name'),
  emotion: element('face-emotion'),
  primary: element('primary-color'),
  secondary: element('secondary-color'),
  mouthOpen: element('mouth-open'),
  mouthOpenOutput: element('mouth-open-output'),
  canvas: element('face-canvas'),
  faceFrame: element('face-frame'),
  frameBackground: element('face-frame-background'),
  frameOutline: element('face-frame-outline'),
  leftIris: element('left-eye-iris'),
  leftLid: element('left-eye-lid'),
  rightIris: element('right-eye-iris'),
  rightLid: element('right-eye-lid'),
  mouthPreview: element('mouth-preview'),
  status: element('face-status'),
  codePreview: element('shape-code-preview'),
  fileInput: element('face-file-input'),
}

const controls = {
  canvas: {
    left: element('canvas-left'),
    top: element('canvas-top'),
    width: element('canvas-width'),
    height: element('canvas-height'),
  },
  leftEye: {
    x: element('left-eye-x'),
    y: element('left-eye-y'),
    radius: element('left-eye-radius'),
    eyelidWidth: element('left-eyelid-width'),
    eyelidHeight: element('left-eyelid-height'),
  },
  rightEye: {
    x: element('right-eye-x'),
    y: element('right-eye-y'),
    radius: element('right-eye-radius'),
    eyelidWidth: element('right-eyelid-width'),
    eyelidHeight: element('right-eyelid-height'),
  },
  mouth: {
    x: element('mouth-x'),
    y: element('mouth-y'),
    minWidth: element('mouth-min-width'),
    maxWidth: element('mouth-max-width'),
    minHeight: element('mouth-min-height'),
    maxHeight: element('mouth-max-height'),
  },
}

function values(group) {
  return Object.fromEntries(Object.entries(group).map(([key, input]) => [key, Number(input.value)]))
}

export function assetFromShapeEditorValues({
  name,
  emotion,
  primary,
  secondary,
  mouth,
  canvas,
  leftEye,
  rightEye,
  mouthShape,
}) {
  return createFaceAsset({
    name,
    emotion,
    primary,
    secondary,
    mouth,
    canvas,
    shape: {
      eyes: { left: leftEye, right: rightEye },
      mouth: mouthShape,
    },
  })
}

function currentAsset() {
  return assetFromShapeEditorValues({
    name: elements.name.value,
    emotion: elements.emotion.value,
    primary: elements.primary.value,
    secondary: elements.secondary.value,
    mouth: Number(elements.mouthOpen.value),
    canvas: values(controls.canvas),
    leftEye: values(controls.leftEye),
    rightEye: values(controls.rightEye),
    mouthShape: values(controls.mouth),
  })
}

function setValues(group, value) {
  for (const [key, input] of Object.entries(group)) input.value = String(value[key])
}

function setEyeValues(group, eye) {
  setValues(group, eye)
  const diameter = eye.radius * 2
  group.eyelidWidth.min = String(diameter)
  group.eyelidHeight.min = String(diameter)
}

function applyAsset(asset) {
  const normalized = createFaceAsset(asset)
  elements.name.value = normalized.name
  elements.emotion.value = normalized.emotion
  elements.primary.value = normalized.colors.primary
  elements.secondary.value = normalized.colors.secondary
  elements.mouthOpen.value = String(normalized.mouth)
  setValues(controls.canvas, normalized.canvas)
  setEyeValues(controls.leftEye, normalized.shape.eyes.left)
  setEyeValues(controls.rightEye, normalized.shape.eyes.right)
  setValues(controls.mouth, normalized.shape.mouth)
  render()
}

function setCircle(circle, eye) {
  circle.setAttribute('cx', eye.x)
  circle.setAttribute('cy', eye.y)
  circle.setAttribute('r', eye.radius)
}

function eyelidPath(eye, side, emotion) {
  const left = eye.x - eye.eyelidWidth / 2
  const top = eye.y - eye.eyelidHeight / 2
  const right = left + eye.eyelidWidth
  const bottom = top + eye.eyelidHeight
  if (emotion === 'HAPPY') {
    const y = top + eye.eyelidHeight * 0.6
    return `M ${left} ${y} H ${right} V ${bottom} H ${left} Z`
  }
  if (emotion === 'SLEEPY') {
    const y = top + eye.eyelidHeight * 0.5
    return `M ${left} ${top} H ${right} V ${y} H ${left} Z`
  }
  if (emotion === 'ANGRY' || emotion === 'SAD') {
    const leftIsCovered = (emotion === 'ANGRY' && side === 'right') || (emotion === 'SAD' && side === 'left')
    const leftDepth = top + eye.eyelidHeight * (leftIsCovered ? 0.5 : 0)
    const rightDepth = top + eye.eyelidHeight * (leftIsCovered ? 0 : 0.5)
    return `M ${left} ${top} L ${left} ${leftDepth} L ${right} ${rightDepth} L ${right} ${top} Z`
  }
  return ''
}

function setLid(path, eye, side, emotion) {
  path.setAttribute('d', eyelidPath(eye, side, emotion))
}

function render() {
  const asset = currentAsset()
  const { canvas, shape } = asset
  elements.canvas.dataset.emotion = asset.emotion
  elements.canvas.style.setProperty('--face-primary', asset.colors.primary)
  elements.canvas.style.setProperty('--face-secondary', asset.colors.secondary)
  elements.faceFrame.setAttribute('transform', `translate(${canvas.left} ${canvas.top})`)
  for (const rectangle of [elements.frameBackground, elements.frameOutline]) {
    rectangle.setAttribute('x', 0)
    rectangle.setAttribute('y', 0)
    rectangle.setAttribute('width', canvas.width)
    rectangle.setAttribute('height', canvas.height)
  }

  setCircle(elements.leftIris, shape.eyes.left)
  setCircle(elements.rightIris, shape.eyes.right)
  setLid(elements.leftLid, shape.eyes.left, 'left', asset.emotion)
  setLid(elements.rightLid, shape.eyes.right, 'right', asset.emotion)

  const open = asset.mouth
  const mouthWidth = shape.mouth.minWidth + (shape.mouth.maxWidth - shape.mouth.minWidth) * (1 - open)
  const mouthHeight = shape.mouth.minHeight + (shape.mouth.maxHeight - shape.mouth.minHeight) * open
  elements.mouthPreview.setAttribute('x', shape.mouth.x - mouthWidth / 2)
  elements.mouthPreview.setAttribute('y', shape.mouth.y - mouthHeight / 2)
  elements.mouthPreview.setAttribute('width', mouthWidth)
  elements.mouthPreview.setAttribute('height', mouthHeight)
  elements.mouthPreview.setAttribute('rx', Math.min(mouthWidth, mouthHeight) / 2)

  elements.mouthOpenOutput.value = open.toFixed(2)
  elements.codePreview.textContent = `${shapeFaceDefinition(asset)}

export function onContextCreated(robot) {
  robot.ui.setFace(new _StackchanVisualShapeFace({}))
}`
  return asset
}

function setStatus(message, state = '') {
  elements.status.textContent = message
  elements.status.dataset.state = state
}

elements.form.addEventListener('input', () => {
  for (const eyeControls of [controls.leftEye, controls.rightEye]) {
    const diameter = Number(eyeControls.radius.value) * 2
    eyeControls.eyelidWidth.min = String(diameter)
    eyeControls.eyelidHeight.min = String(diameter)
    if (Number(eyeControls.eyelidWidth.value) < diameter) eyeControls.eyelidWidth.value = String(diameter)
    if (Number(eyeControls.eyelidHeight.value) < diameter) eyeControls.eyelidHeight.value = String(diameter)
  }
  render()
  setStatus('Shape型Faceを編集中です。')
})

elements.form.addEventListener('change', () => applyAsset(currentAsset()))

function pointInCanvas(event) {
  const bounds = elements.canvas.getBoundingClientRect()
  return {
    x: ((event.clientX - bounds.left) / bounds.width) * 320,
    y: ((event.clientY - bounds.top) / bounds.height) * 240,
  }
}

const positionControls = {
  'left-eye': controls.leftEye,
  'right-eye': controls.rightEye,
  mouth: controls.mouth,
}
let drag = null

elements.canvas.addEventListener('pointerdown', (event) => {
  const part = event.target.closest('[data-part]')
  if (!part) return
  const asset = currentAsset()
  const group = positionControls[part.dataset.part]
  const point = pointInCanvas(event)
  drag = {
    pointerId: event.pointerId,
    group,
    offsetX: point.x - asset.canvas.left - Number(group.x.value),
    offsetY: point.y - asset.canvas.top - Number(group.y.value),
  }
  part.setPointerCapture(event.pointerId)
  part.focus()
  event.preventDefault()
})

elements.canvas.addEventListener('pointermove', (event) => {
  if (!drag || drag.pointerId !== event.pointerId) return
  const asset = currentAsset()
  const point = pointInCanvas(event)
  drag.group.x.value = String(
    Math.round(Math.min(asset.canvas.width, Math.max(0, point.x - asset.canvas.left - drag.offsetX)))
  )
  drag.group.y.value = String(
    Math.round(Math.min(asset.canvas.height, Math.max(0, point.y - asset.canvas.top - drag.offsetY)))
  )
  render()
})

const endDrag = (event) => {
  if (drag?.pointerId === event.pointerId) {
    drag = null
    applyAsset(currentAsset())
  }
}
elements.canvas.addEventListener('pointerup', endDrag)
elements.canvas.addEventListener('pointercancel', endDrag)

for (const part of elements.canvas.querySelectorAll('[data-part]')) {
  part.addEventListener('keydown', (event) => {
    const movement = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    }[event.key]
    if (!movement) return
    event.preventDefault()
    const group = positionControls[part.dataset.part]
    const step = event.shiftKey ? 5 : 1
    group.x.value = String(Number(group.x.value) + movement[0] * step)
    group.y.value = String(Number(group.y.value) + movement[1] * step)
    applyAsset(currentAsset())
  })
}

element('load-face').addEventListener('click', () => elements.fileInput.click())
elements.fileInput.addEventListener('change', async () => {
  const [file] = elements.fileInput.files ?? []
  if (!file) return
  try {
    const asset = parseFaceAsset(await file.text())
    applyAsset(asset)
    setStatus(`「${asset.name}」を読み込みました。`, 'success')
  } catch (error) {
    setStatus(`Shape顔を読み込めませんでした: ${error.message}`, 'error')
  } finally {
    elements.fileInput.value = ''
  }
})

element('reset-face').addEventListener('click', () => {
  applyAsset(createFaceAsset())
  setStatus('標準のShape配置へ戻しました。', 'success')
})

element('download-face').addEventListener('click', () => {
  const asset = render()
  const blob = new Blob([`${JSON.stringify(asset, null, 2)}\n`], { type: FACE_ASSET_MEDIA_TYPE })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${asset.name.replace(/[^\p{L}\p{N}._-]/gu, '_')}.stackchan-face.json`
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
  setStatus('Shape顔プロジェクトを保存しました。', 'success')
})

element('send-to-editor').addEventListener('click', () => {
  const asset = render()
  localStorage.setItem('stackchan-face-asset-staging', JSON.stringify(asset))
  setStatus('Shape型Faceを保存しました。ブロックエディタを開きます。', 'success')
  location.href = '../editor/?face-asset=staging'
})

applyAsset(createFaceAsset({ mouth: 0.2 }))
