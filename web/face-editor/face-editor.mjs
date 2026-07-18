import { FACE_ASSET_MEDIA_TYPE, createFaceAsset, parseFaceAsset, shapeFaceDefinition } from '../editor/face-assets.mjs'
import {
  clearFaceEditContext,
  loadFaceDraft,
  loadFaceEditContext,
  saveFaceDraft,
  stageFaceTransfer,
} from './face-editor-storage.mjs'

let activeEditContext = null

const element = (id) => document.getElementById(id)
const elements = {
  form: element('face-form'),
  name: element('face-name'),
  emotion: element('face-emotion'),
  primary: element('primary-color'),
  secondary: element('secondary-color'),
  mouthOpen: element('mouth-open'),
  mouthOpenOutput: element('mouth-open-output'),
  mouthVisible: element('mouth-visible'),
  mouthShapeControls: element('mouth-shape-controls'),
  canvas: element('face-canvas'),
  faceFrame: element('face-frame'),
  frameBackground: element('face-frame-background'),
  frameOutline: element('face-frame-outline'),
  leftIris: element('left-eye-iris'),
  leftLid: element('left-eye-lid'),
  rightIris: element('right-eye-iris'),
  rightLid: element('right-eye-lid'),
  mouthPart: element('mouth-part'),
  mouthPreview: element('mouth-preview'),
  status: element('face-status'),
  codePreview: element('shape-code-preview'),
  fileInput: element('face-file-input'),
  sendToEditor: element('send-to-editor'),
  sendToEditorLabel: document.querySelector('#send-to-editor span'),
}

const controls = {
  canvas: {
    left: element('canvas-left'),
    top: element('canvas-top'),
    width: element('canvas-width'),
    height: element('canvas-height'),
  },
  leftEye: {
    shape: element('left-eye-shape'),
    x: element('left-eye-x'),
    y: element('left-eye-y'),
    radius: element('left-eye-radius'),
    width: element('left-eye-width'),
    height: element('left-eye-height'),
    r: element('left-eye-r'),
    eyelidWidth: element('left-eyelid-width'),
    eyelidHeight: element('left-eyelid-height'),
  },
  rightEye: {
    shape: element('right-eye-shape'),
    x: element('right-eye-x'),
    y: element('right-eye-y'),
    radius: element('right-eye-radius'),
    width: element('right-eye-width'),
    height: element('right-eye-height'),
    r: element('right-eye-r'),
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

function eyeValues(group) {
  const eye = {
    shape: group.shape.value,
    x: Number(group.x.value),
    y: Number(group.y.value),
    eyelidWidth: Number(group.eyelidWidth.value),
    eyelidHeight: Number(group.eyelidHeight.value),
  }
  if (eye.shape === 'roundRect') {
    return {
      ...eye,
      width: Number(group.width.value),
      height: Number(group.height.value),
      r: Number(group.r.value),
    }
  }
  return { ...eye, radius: Number(group.radius.value) }
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
  mouthVisible,
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
      mouth: { ...mouthShape, visible: mouthVisible },
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
    leftEye: eyeValues(controls.leftEye),
    rightEye: eyeValues(controls.rightEye),
    mouthVisible: elements.mouthVisible.checked,
    mouthShape: values(controls.mouth),
  })
}

function setValues(group, value) {
  for (const [key, input] of Object.entries(group)) input.value = String(value[key])
}

function setEyeValues(group, eye) {
  group.shape.value = eye.shape
  group.x.value = String(eye.x)
  group.y.value = String(eye.y)
  if (eye.shape === 'roundRect') {
    group.width.value = String(eye.width)
    group.height.value = String(eye.height)
    group.r.value = String(eye.r)
  } else {
    group.radius.value = String(eye.radius)
  }
  group.eyelidWidth.value = String(eye.eyelidWidth)
  group.eyelidHeight.value = String(eye.eyelidHeight)
  syncEyeControls(group)
}

function setShapeFieldVisibility(input, visible) {
  input.disabled = !visible
  input.closest('label').hidden = !visible
}

function syncEyeControls(group) {
  const roundRect = group.shape.value === 'roundRect'
  setShapeFieldVisibility(group.radius, !roundRect)
  for (const input of [group.width, group.height, group.r]) setShapeFieldVisibility(input, roundRect)

  let width
  let height
  if (roundRect) {
    width = Number(group.width.value)
    height = Number(group.height.value)
    const maximumR = Math.max(0, Math.min(width, height) / 2)
    group.r.max = String(maximumR)
    group.r.value = String(Math.min(maximumR, Math.max(0, Number(group.r.value))))
  } else {
    width = Number(group.radius.value) * 2
    height = width
  }
  group.eyelidWidth.value = String(width)
  group.eyelidHeight.value = String(height)
}

function syncMouthControls() {
  const visible = elements.mouthVisible.checked
  elements.mouthOpen.disabled = !visible
  elements.mouthShapeControls.dataset.disabled = String(!visible)
  for (const input of Object.values(controls.mouth)) input.disabled = !visible
}

function applyAsset(asset) {
  const normalized = createFaceAsset(asset)
  elements.name.value = normalized.name
  elements.emotion.value = normalized.emotion
  elements.primary.value = normalized.colors.primary
  elements.secondary.value = normalized.colors.secondary
  elements.mouthOpen.value = String(normalized.mouth)
  elements.mouthVisible.checked = normalized.shape.mouth.visible
  setValues(controls.canvas, normalized.canvas)
  setEyeValues(controls.leftEye, normalized.shape.eyes.left)
  setEyeValues(controls.rightEye, normalized.shape.eyes.right)
  setValues(controls.mouth, normalized.shape.mouth)
  syncMouthControls()
  return render()
}

function setIris(rectangle, eye) {
  const roundRect = eye.shape === 'roundRect'
  const width = roundRect ? eye.width : eye.radius * 2
  const height = roundRect ? eye.height : eye.radius * 2
  const r = roundRect ? eye.r : eye.radius
  rectangle.dataset.shape = eye.shape
  rectangle.setAttribute('x', eye.x - width / 2)
  rectangle.setAttribute('y', eye.y - height / 2)
  rectangle.setAttribute('width', width)
  rectangle.setAttribute('height', height)
  rectangle.setAttribute('rx', r)
  rectangle.setAttribute('ry', r)
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

  setIris(elements.leftIris, shape.eyes.left)
  setIris(elements.rightIris, shape.eyes.right)
  setLid(elements.leftLid, shape.eyes.left, 'left', asset.emotion)
  setLid(elements.rightLid, shape.eyes.right, 'right', asset.emotion)

  elements.mouthPart.toggleAttribute('hidden', !shape.mouth.visible)
  const open = asset.mouth
  const mouthWidth = shape.mouth.minWidth + (shape.mouth.maxWidth - shape.mouth.minWidth) * (1 - open)
  const mouthHeight = shape.mouth.minHeight + (shape.mouth.maxHeight - shape.mouth.minHeight) * open
  elements.mouthPreview.setAttribute('x', shape.mouth.x - mouthWidth / 2)
  elements.mouthPreview.setAttribute('y', shape.mouth.y - mouthHeight / 2)
  elements.mouthPreview.setAttribute('width', mouthWidth)
  elements.mouthPreview.setAttribute('height', mouthHeight)
  elements.mouthPreview.removeAttribute('rx')

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

function persistDraft(asset) {
  try {
    saveFaceDraft(asset)
    return true
  } catch (error) {
    setStatus(`下書きを保存できませんでした: ${error.message}`, 'error')
    return false
  }
}

elements.form.addEventListener('input', () => {
  for (const eyeControls of [controls.leftEye, controls.rightEye]) syncEyeControls(eyeControls)
  syncMouthControls()
  const asset = render()
  if (persistDraft(asset)) setStatus('Shape型Faceを編集中です。')
})

elements.form.addEventListener('change', () => persistDraft(applyAsset(currentAsset())))

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
    persistDraft(applyAsset(currentAsset()))
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
    persistDraft(applyAsset(currentAsset()))
  })
}

element('load-face').addEventListener('click', () => elements.fileInput.click())
elements.fileInput.addEventListener('change', async () => {
  const [file] = elements.fileInput.files ?? []
  if (!file) return
  try {
    const asset = parseFaceAsset(await file.text())
    const rendered = applyAsset(asset)
    if (persistDraft(rendered)) setStatus(`「${asset.name}」を読み込みました。`, 'success')
  } catch (error) {
    setStatus(`Shape顔を読み込めませんでした: ${error.message}`, 'error')
  } finally {
    elements.fileInput.value = ''
  }
})

element('reset-face').addEventListener('click', () => {
  const asset = applyAsset(createFaceAsset())
  if (persistDraft(asset)) setStatus('標準のShape配置へ戻しました。', 'success')
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

elements.sendToEditor.addEventListener('click', () => {
  const asset = render()
  try {
    saveFaceDraft(asset)
    stageFaceTransfer(asset, activeEditContext)
    setStatus('Shape型Faceを保存しました。ブロックエディタを開きます。', 'success')
    location.href = '../editor/?face-asset=staging'
  } catch (error) {
    setStatus(`ブロックエディタへ顔を渡せませんでした: ${error.message}`, 'error')
  }
})

function loadInitialFace() {
  const fromProject = new URLSearchParams(location.search).get('face-edit') === 'project'
  if (fromProject) {
    try {
      const transfer = loadFaceEditContext()
      if (!transfer?.edit) throw new TypeError('編集元の情報がありません')
      activeEditContext = transfer.edit
      return {
        asset: transfer.asset,
        message: `「${transfer.asset.name}」をMODプロジェクトから読み込みました。`,
        state: 'success',
      }
    } catch (error) {
      try {
        const draft = loadFaceDraft()
        if (draft) {
          return {
            asset: draft,
            message: `MODの顔データを読み込めなかったため、下書きを復元しました: ${error.message}`,
            state: 'error',
          }
        }
      } catch {
        // The original edit-context error is more useful than a secondary draft error.
      }
      return {
        asset: createFaceAsset(),
        message: `MODの顔データを読み込めなかったため、標準Faceを開きました: ${error.message}`,
        state: 'error',
      }
    }
  }

  try {
    clearFaceEditContext()
  } catch {
    // A stale context is ignored unless this page was explicitly opened for project editing.
  }
  try {
    const draft = loadFaceDraft()
    if (draft) return { asset: draft, message: '前回の下書きを復元しました。', state: 'success' }
  } catch (error) {
    return {
      asset: createFaceAsset(),
      message: `保存された下書きを読み込めなかったため、標準Faceを開きました: ${error.message}`,
      state: 'error',
    }
  }
  return { asset: createFaceAsset(), message: 'Shape型Faceを編集中です。', state: '' }
}

const initialFace = loadInitialFace()
if (activeEditContext) {
  elements.sendToEditorLabel.textContent = '変更を反映'
  elements.sendToEditor.title = '変更をMODへ反映して戻る'
}
const initialAsset = applyAsset(initialFace.asset)
if (persistDraft(initialAsset)) setStatus(initialFace.message, initialFace.state)
