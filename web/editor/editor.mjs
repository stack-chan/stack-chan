import { registerStackchanBlocks, localizedToolbox, generateModSource } from './blocks.mjs'
import { loadBlocklyMessages } from './blockly-locale.mjs'
import { getLocale, i18nReady, t } from '../i18n.mjs'
import { buildModArchive, isXsArchive, manifestForProjectAssets, xsArchiveVersion } from './mod-builder.mjs'
import {
  createEsptoolLoader,
  DEVICE_OPERATION_STATUS,
  installModToDevice,
  removeModFromDevice,
} from './esptool-installer.mjs'
import { createModStorage, formatByteSize } from '../simulator/mod-storage.mjs'
import { DEVICE_PROFILES, inspectDeploymentCompatibility, profileFor, toolboxForTarget } from './capabilities.mjs'
import {
  createVisualProject,
  assetBytes,
  MAX_ASSET_BYTES,
  MAX_ASSET_COUNT,
  MAX_PROJECT_JSON_BYTES,
  parseVisualProject,
  projectFileName,
  serializeVisualProject,
} from './project-format.mjs'
import { analyzeWorkspace } from './project-validator.mjs'
import { addFaceAssetToProject, FACE_ASSET_MEDIA_TYPE, applyFaceAssetToSource, parseFaceAsset } from './face-assets.mjs'
import { parseVisualTrace } from './runtime-diagnostics.mjs'
import {
  createRecoveryRecord,
  duplicateVisualProject,
  parseProjectLibrary,
  updateProjectLibrary,
} from './project-library.mjs'
import { createProjectStorage } from './project-storage.mjs'
import { VISUAL_SAMPLES, sampleById } from './samples.mjs'
import { fetchExternalProject, projectUrlFromSearch } from './external-project.mjs'
import {
  clearFaceEditContext,
  clearStagedFaceTransfer,
  loadStagedFaceTransfer,
  saveFaceEditContext,
} from '../face-editor/face-editor-storage.mjs'
import createTools from './vendor/tools.js'

await i18nReady
await loadBlocklyMessages(getLocale())

const TOOLBOX = localizedToolbox()

const WORKSPACE_STORAGE_KEY = 'stackchan-blockly-workspace'
const PROJECT_STORAGE_KEY = 'stackchan-visual-project-v1'
const PROJECT_LIBRARY_KEY = 'stackchan-visual-project-library-v1'
const PROJECT_RECOVERY_KEY = 'stackchan-visual-project-recovery-v1'
const METRICS_STORAGE_KEY = 'stackchan-visual-metrics-v1'

const Blockly = globalThis.Blockly
const javascriptGenerator = globalThis.javascript?.javascriptGenerator ?? Blockly?.JavaScript
const Order = globalThis.javascript?.Order ?? { NONE: 99, FUNCTION_CALL: 2 }

const workspaceHost = document.getElementById('blockly-workspace')
const codePreview = document.getElementById('code-preview')
const buildButton = document.getElementById('build-button')
const downloadButton = document.getElementById('download-button')
const installSimulatorButton = document.getElementById('install-simulator-button')
const installDeviceButton = document.getElementById('install-device-button')
const buildStatus = document.getElementById('build-status')
const installProgress = document.getElementById('install-progress')
const sampleButton = document.getElementById('sample-button')
const clearButton = document.getElementById('clear-button')
const logOutput = document.getElementById('log-output')
const outputTabs = [...document.querySelectorAll('.output-tabs [role="tab"]')]
const projectNameInput = document.getElementById('project-name')
const projectNameDisplay = document.getElementById('project-name-display')
const projectNameLabel = document.getElementById('project-name-label')
const targetDeviceSelect = document.getElementById('target-device')
const importButton = document.getElementById('import-button')
const exportButton = document.getElementById('export-button')
const projectFileInput = document.getElementById('project-file-input')
const capabilitySummary = document.getElementById('capability-summary')
const diagnosticsList = document.getElementById('diagnostics-list')
const diagnosticsCount = document.getElementById('diagnostics-count')
const assetButton = document.getElementById('asset-button')
const assetFileInput = document.getElementById('asset-file-input')
const assetSummary = document.getElementById('asset-summary')
const faceSelectionButton = document.getElementById('face-selection-button')
const faceSelectionLabel = document.getElementById('face-selection-label')
const faceSelectionMenu = document.getElementById('face-selection-menu')
const faceSelectionList = document.getElementById('face-selection-list')
const editFaceButton = document.getElementById('edit-face-button')
const faceEditorNavigationLink = document.querySelector('.tool-drawer-link[data-tool-id="face-editor"]')
const embedAssetsInput = document.getElementById('embed-assets')
const simulatorDialog = document.getElementById('simulator-dialog')
const simulatorFrame = document.getElementById('simulator-frame')
const simulatorRestart = document.getElementById('simulator-restart')
const simulatorStop = document.getElementById('simulator-stop')
const simulatorClose = document.getElementById('simulator-close')
const removeDeviceButton = document.getElementById('remove-device-button')
const newProjectButton = document.getElementById('new-project-button')
const duplicateProjectButton = document.getElementById('duplicate-project-button')
const recentProjectsControl = document.getElementById('recent-projects-control')
const recentProjectsButton = document.getElementById('recent-projects-button')
const recentProjectsSubmenu = document.getElementById('recent-projects-submenu')
const recentProjectsList = document.getElementById('recent-projects-list')
const recoveryButton = document.getElementById('recovery-button')
const sampleDialog = document.getElementById('sample-dialog')
const sampleList = document.getElementById('sample-list')
const sampleClose = document.getElementById('sample-close')
const projectMenuButton = document.getElementById('project-menu-button')
const projectMenu = document.getElementById('project-menu')
const mobileTargetDeviceSelect = document.getElementById('mobile-target-device')
const clearWorkspaceDialog = document.getElementById('clear-workspace-dialog')
const clearWorkspaceProjectName = document.getElementById('clear-workspace-project-name')
const clearWorkspaceConfirm = document.getElementById('clear-workspace-confirm')

function selectOutputTab(tab) {
  for (const candidate of outputTabs) {
    const selected = candidate === tab
    candidate.setAttribute('aria-selected', String(selected))
    candidate.tabIndex = selected ? 0 : -1
    const panel = document.getElementById(candidate.getAttribute('aria-controls'))
    if (panel != null) panel.hidden = !selected
  }
}

for (const tab of outputTabs) {
  tab.addEventListener('click', () => selectOutputTab(tab))
  tab.addEventListener('keydown', (event) => {
    const index = outputTabs.indexOf(tab)
    let nextIndex
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % outputTabs.length
    else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + outputTabs.length) % outputTabs.length
    else if (event.key === 'Home') nextIndex = 0
    else if (event.key === 'End') nextIndex = outputTabs.length - 1
    else return
    event.preventDefault()
    outputTabs[nextIndex].focus()
    selectOutputTab(outputTabs[nextIndex])
  })
}
selectOutputTab(outputTabs.find((tab) => tab.getAttribute('aria-selected') === 'true') ?? outputTabs[0])

const logLines = []
function log(text) {
  logLines.push(String(text))
  if (logLines.length > 400) logLines.splice(0, logLines.length - 400)
  logOutput.textContent = logLines.join('\n')
  logOutput.scrollTop = logOutput.scrollHeight
}

function setStatus(text) {
  buildStatus.textContent = t(text)
}

const SAMPLE_WORKSPACE = {
  blocks: {
    languageVersion: 0,
    blocks: [
      {
        type: 'stackchan_on_start',
        x: 24,
        y: 24,
        inputs: {
          DO: {
            block: {
              type: 'stackchan_set_emotion',
              fields: { EMOTION: 'HAPPY' },
              next: {
                block: {
                  type: 'stackchan_show_balloon',
                  inputs: { TEXT: { shadow: { type: 'text', fields: { TEXT: 'ブロックから こんにちは!' } } } },
                },
              },
            },
          },
        },
      },
      {
        type: 'stackchan_on_button',
        x: 24,
        y: 240,
        fields: { BUTTON: 'a' },
        inputs: {
          DO: {
            block: {
              type: 'stackchan_say',
              inputs: { TEXT: { shadow: { type: 'text', fields: { TEXT: 'ぼく ｽﾀｯｸﾁｬﾝ!' } } } },
            },
          },
        },
      },
      {
        type: 'stackchan_every',
        x: 320,
        y: 24,
        fields: { SECONDS: 10 },
        inputs: {
          DO: {
            block: {
              type: 'stackchan_look_at',
              fields: { X: 1, Y: 0.5, Z: 0 },
              next: {
                block: {
                  type: 'stackchan_wait',
                  fields: { DURATION: 2000 },
                  next: { block: { type: 'stackchan_look_away' } },
                },
              },
            },
          },
        },
      },
    ],
  },
}

for (const [value, profile] of Object.entries(DEVICE_PROFILES)) {
  const option = document.createElement('option')
  option.value = value
  option.textContent = t(profile.label)
  targetDeviceSelect.append(option)
}

if (!Blockly || !javascriptGenerator) {
  setStatus('Blocklyを読み込めませんでした。ネットワーク接続を確認してください。')
  throw new Error('Blockly failed to load')
}

registerStackchanBlocks(Blockly, javascriptGenerator, Order)

const workspace = Blockly.inject(workspaceHost, {
  toolbox: TOOLBOX,
  renderer: 'zelos',
  grid: { spacing: 24, length: 2, colour: '#e4ddcf', snap: true },
  zoom: { controls: true, wheel: true, startScale: 0.9 },
  trashcan: true,
})

function loadWorkspace(state) {
  Blockly.serialization.workspaces.load(state, workspace)
}

let currentProject
const projectStorage = createProjectStorage()
let storedProjectState = null
try {
  storedProjectState = await projectStorage.loadState()
} catch (error) {
  log(`IndexedDBのプロジェクトを復元できませんでした: ${error.message}`)
}
let projectLibrary = storedProjectState?.projects ?? parseProjectLibrary(localStorage.getItem(PROJECT_LIBRARY_KEY))
let recoveryRecord = null
try {
  recoveryRecord = await projectStorage.loadRecovery()
  if (!recoveryRecord) recoveryRecord = JSON.parse(localStorage.getItem(PROJECT_RECOVERY_KEY) ?? 'null')
} catch (error) {
  log(`復旧データを読み込めませんでした: ${error.message}`)
}
const savedProject = localStorage.getItem(PROJECT_STORAGE_KEY)
try {
  const savedWorkspace = localStorage.getItem(WORKSPACE_STORAGE_KEY)
  currentProject =
    storedProjectState?.currentProject ??
    (savedProject
      ? parseVisualProject(savedProject)
      : createVisualProject({ workspace: savedWorkspace ? JSON.parse(savedWorkspace) : SAMPLE_WORKSPACE }))
  loadWorkspace(currentProject.workspace)
} catch (error) {
  log(`ワークスペースの復元に失敗しました: ${error.message}`)
  if (savedProject) {
    recoveryRecord = createRecoveryRecord(savedProject, error)
    void projectStorage.saveRecovery(recoveryRecord).catch((storageError) => {
      log(`復旧データを保存できませんでした: ${storageError.message}`)
    })
  }
  currentProject = createVisualProject({ workspace: SAMPLE_WORKSPACE })
  loadWorkspace(SAMPLE_WORKSPACE)
}
projectNameInput.value = currentProject.name
renderProjectName()
targetDeviceSelect.value = DEVICE_PROFILES[currentProject.target] ? currentProject.target : 'portable'
currentProject.target = targetDeviceSelect.value
embedAssetsInput.checked = currentProject.settings.embedAssets
workspace.updateToolbox(toolboxForTarget(TOOLBOX, targetDeviceSelect.value))

let currentSource = ''
let currentArchive = null
let currentAnalysis
let currentGenerationError = null
let simulatorMetricPending = false
let deviceOperationPending = false

function refreshDeviceActionButtons() {
  const available =
    !deviceOperationPending && 'serial' in navigator && profileFor(targetDeviceSelect.value).deviceInstall
  installDeviceButton.disabled = !available || !currentArchive
  removeDeviceButton.disabled = !available
}

function workspaceState() {
  return Blockly.serialization.workspaces.save(workspace)
}

let projectSave = Promise.resolve(true)
function queueProjectSave() {
  const snapshot = structuredClone({ currentProject, projects: projectLibrary })
  projectSave = projectSave.then(async () => {
    try {
      await projectStorage.saveState(snapshot)
      return true
    } catch (error) {
      log(`プロジェクトを自動保存できませんでした: ${error.message}`)
      setStatus('自動保存に失敗しました。プロジェクトを書き出してください。')
      return false
    }
  })
  return projectSave
}

function persistProject(project = currentProject) {
  const nextProject = createVisualProject({
    ...project,
    name: projectNameInput.value.trim() || 'はじめてのMOD',
    target: targetDeviceSelect.value,
    workspace: workspaceState(),
    settings: { ...project.settings, embedAssets: embedAssetsInput.checked },
    updatedAt: new Date().toISOString(),
  })
  const nextProjectLibrary = updateProjectLibrary(projectLibrary, nextProject)
  currentProject = nextProject
  projectLibrary = nextProjectLibrary
  projectNameInput.value = nextProject.name
  queueProjectSave()
  renderProjectName()
  renderRecentProjects()
  return currentProject
}

function renderRecentProjects() {
  const projects = projectLibrary.some((project) => project.id === currentProject?.id)
    ? projectLibrary
    : [currentProject, ...projectLibrary].filter(Boolean)
  recentProjectsList.replaceChildren()
  recentProjectsButton.disabled = projects.length === 0
  if (projects.length === 0) {
    const empty = document.createElement('p')
    empty.className = 'recent-projects-empty'
    empty.textContent = t('最近開いたプロジェクトはありません')
    recentProjectsList.append(empty)
    setRecentProjectsSubmenuOpen(false)
    return
  }
  for (const project of projects) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'recent-project-item'
    button.dataset.projectId = project.id
    button.setAttribute('role', 'menuitem')
    if (project.id === currentProject.id) button.setAttribute('aria-current', 'true')

    const copy = document.createElement('span')
    copy.className = 'recent-project-item-copy'
    const name = document.createElement('strong')
    name.textContent = project.name
    const detail = document.createElement('small')
    const updatedAt = new Intl.DateTimeFormat(getLocale(), { dateStyle: 'medium', timeStyle: 'short' }).format(
      new Date(project.updatedAt)
    )
    detail.textContent =
      project.id === currentProject.id ? t('現在開いています · {updatedAt}', { updatedAt }) : updatedAt
    copy.append(name, detail)
    button.append(copy)
    button.addEventListener('click', () => {
      setProjectMenuOpen(false)
      activateProject(project, t('「{name}」を開きました', { name: project.name }))
    })
    recentProjectsList.append(button)
  }
}

function copySelectOptions(source, target) {
  target.replaceChildren(...[...source.options].map((option) => option.cloneNode(true)))
  target.value = source.value
}

function renderProjectName() {
  const name = projectNameInput.value.trim() || currentProject?.name || 'はじめてのMOD'
  projectNameLabel.textContent = name
  projectNameDisplay.title = name
  projectNameDisplay.setAttribute('aria-label', t('プロジェクト名「{name}」を編集', { name }))
}

function startProjectNameEdit() {
  projectNameInput.value = currentProject.name
  projectNameDisplay.hidden = true
  projectNameInput.hidden = false
  projectNameInput.focus()
  projectNameInput.select()
}

function finishProjectNameEdit({ cancel = false, focusDisplay = false } = {}) {
  if (projectNameInput.hidden) return
  projectNameInput.value = cancel ? currentProject.name : projectNameInput.value.trim() || 'はじめてのMOD'
  if (!cancel) persistProject()
  projectNameInput.hidden = true
  projectNameDisplay.hidden = false
  renderProjectName()
  if (focusDisplay) projectNameDisplay.focus()
}

function visibleProjectMenuItems() {
  return [recentProjectsButton, ...projectMenu.querySelectorAll('.project-menu-actions > [role="menuitem"]')].filter(
    (item) => !item.hidden && !item.disabled && item.getClientRects().length > 0
  )
}

function visibleRecentProjectItems() {
  return [...recentProjectsList.querySelectorAll('[role="menuitem"]')].filter(
    (item) => !item.hidden && item.getClientRects().length > 0
  )
}

function setRecentProjectsSubmenuOpen(open, { focusItem = false } = {}) {
  const nextOpen = Boolean(open && !recentProjectsButton.disabled && !projectMenu.hidden)
  recentProjectsSubmenu.hidden = !nextOpen
  recentProjectsButton.setAttribute('aria-expanded', String(nextOpen))
  if (nextOpen && focusItem) requestAnimationFrame(() => visibleRecentProjectItems()[0]?.focus())
}

function setProjectMenuOpen(open, { focusItem = false } = {}) {
  if (open) copySelectOptions(targetDeviceSelect, mobileTargetDeviceSelect)
  else setRecentProjectsSubmenuOpen(false)
  projectMenu.hidden = !open
  projectMenuButton.setAttribute('aria-expanded', String(open))
  if (open && focusItem) requestAnimationFrame(() => visibleProjectMenuItems()[0]?.focus())
}

projectNameDisplay.addEventListener('click', startProjectNameEdit)
projectNameInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault()
    finishProjectNameEdit({ focusDisplay: true })
  } else if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    finishProjectNameEdit({ cancel: true, focusDisplay: true })
  }
})
projectNameInput.addEventListener('blur', () => finishProjectNameEdit())

projectMenuButton.addEventListener('click', (event) => {
  event.stopPropagation()
  setProjectMenuOpen(projectMenu.hidden, { focusItem: projectMenu.hidden })
})
projectMenu.addEventListener('click', (event) => {
  const menuItem = event.target.closest('[role="menuitem"]')
  if (menuItem && menuItem !== recentProjectsButton) setProjectMenuOpen(false)
})
projectMenu.addEventListener('keydown', (event) => {
  const items = visibleProjectMenuItems()
  const index = items.indexOf(document.activeElement)
  if (index < 0) return
  let nextIndex
  if (event.key === 'ArrowDown') nextIndex = (index + 1) % items.length
  else if (event.key === 'ArrowUp') nextIndex = (index - 1 + items.length) % items.length
  else if (event.key === 'Home') nextIndex = 0
  else if (event.key === 'End') nextIndex = items.length - 1
  else return
  event.preventDefault()
  items[nextIndex]?.focus()
})
recentProjectsControl.addEventListener('mouseenter', () => {
  if (innerWidth > 760 && matchMedia('(hover: hover)').matches) setRecentProjectsSubmenuOpen(true)
})
recentProjectsControl.addEventListener('mouseleave', () => {
  if (innerWidth > 760 && matchMedia('(hover: hover)').matches) setRecentProjectsSubmenuOpen(false)
})
recentProjectsControl.addEventListener('focusout', (event) => {
  if (innerWidth > 760 && !recentProjectsControl.contains(event.relatedTarget)) {
    setRecentProjectsSubmenuOpen(false)
  }
})
recentProjectsButton.addEventListener('click', (event) => {
  const shouldToggle = innerWidth <= 760 || event.detail === 0
  setRecentProjectsSubmenuOpen(shouldToggle ? recentProjectsSubmenu.hidden : true)
})
recentProjectsButton.addEventListener('keydown', (event) => {
  if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return
  event.preventDefault()
  event.stopPropagation()
  setRecentProjectsSubmenuOpen(true, { focusItem: true })
})
recentProjectsSubmenu.addEventListener('keydown', (event) => {
  const items = visibleRecentProjectItems()
  const index = items.indexOf(document.activeElement)
  if (['Escape', 'ArrowRight'].includes(event.key)) {
    event.preventDefault()
    event.stopPropagation()
    setRecentProjectsSubmenuOpen(false)
    recentProjectsButton.focus()
    return
  }
  if (index < 0) return
  let nextIndex
  if (event.key === 'ArrowDown') nextIndex = (index + 1) % items.length
  else if (event.key === 'ArrowUp') nextIndex = (index - 1 + items.length) % items.length
  else if (event.key === 'Home') nextIndex = 0
  else if (event.key === 'End') nextIndex = items.length - 1
  else return
  event.preventDefault()
  event.stopPropagation()
  items[nextIndex]?.focus()
})
document.addEventListener('click', (event) => {
  if (!projectMenu.hidden && !event.target.closest('.project-menu-control')) setProjectMenuOpen(false)
})
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || projectMenu.hidden) return
  setProjectMenuOpen(false)
  projectMenuButton.focus()
})

mobileTargetDeviceSelect.addEventListener('change', () => {
  targetDeviceSelect.value = mobileTargetDeviceSelect.value
  targetDeviceSelect.dispatchEvent(new Event('change', { bubbles: true }))
})

function activateProject(project, message) {
  currentProject = project
  projectNameInput.value = project.name
  targetDeviceSelect.value = DEVICE_PROFILES[project.target] ? project.target : 'portable'
  embedAssetsInput.checked = project.settings.embedAssets
  workspace.updateToolbox(toolboxForTarget(TOOLBOX, targetDeviceSelect.value))
  loadWorkspace(project.workspace)
  currentArchive = null
  downloadButton.disabled = true
  installSimulatorButton.disabled = true
  installDeviceButton.disabled = true
  persistProject()
  renderAssets()
  refreshCode()
  setStatus(message)
}

function faceAssetEntries() {
  return currentProject.assets
    .filter((asset) => asset.mediaType === FACE_ASSET_MEDIA_TYPE)
    .map((asset) => {
      let name = asset.path.replace(/^assets\//, '').replace(/\.stackchan-face\.json$/i, '')
      try {
        name = parseFaceAsset(new TextDecoder().decode(assetBytes(asset))).name
      } catch {
        // Invalid Face assets remain visible so the project can remove them.
      }
      return { asset, name }
    })
}

function visibleFaceSelectionItems() {
  return [...faceSelectionList.querySelectorAll('[role="menuitemradio"]')].filter(
    (item) => !item.hidden && item.getClientRects().length > 0
  )
}

function setFaceSelectionMenuOpen(open, { focusItem = false } = {}) {
  faceSelectionMenu.hidden = !open
  faceSelectionButton.setAttribute('aria-expanded', String(open))
  if (open && focusItem) requestAnimationFrame(() => visibleFaceSelectionItems()[0]?.focus())
}

function renderFaceSelection() {
  const entries = faceAssetEntries()
  const selectedPath = currentProject.settings.faceAsset ?? ''
  const selected = entries.find(({ asset }) => asset.path === selectedPath)
  const selectedName = selected?.name ?? t('標準Face')
  faceSelectionLabel.textContent = selectedName
  faceSelectionButton.title = t('使用中のFace: {name}', { name: selectedName })
  editFaceButton.disabled = !selected
  editFaceButton.title = selected
    ? t('「{name}」を顔エディタで編集', { name: selected.name })
    : t('標準Faceは編集できません')
  faceSelectionList.replaceChildren()

  const options = [
    { path: '', name: t('標準Face'), detail: t('ファームウェア標準') },
    ...entries.map(({ asset, name }) => ({ path: asset.path, name, detail: t('カスタムFace') })),
  ]
  for (const option of options) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'face-selection-option'
    button.dataset.faceAsset = option.path
    button.setAttribute('role', 'menuitemradio')
    button.setAttribute('aria-checked', String(option.path === selectedPath))
    const marker = document.createElement('span')
    marker.className = 'face-selection-option-marker'
    marker.textContent = '✓'
    marker.setAttribute('aria-hidden', 'true')
    const copy = document.createElement('span')
    copy.className = 'face-selection-option-copy'
    const name = document.createElement('strong')
    name.textContent = option.name
    const detail = document.createElement('small')
    detail.textContent = option.detail
    copy.append(name, detail)
    button.append(marker, copy)
    button.addEventListener('click', () => {
      setFaceSelectionMenuOpen(false)
      currentProject.settings.faceAsset = option.path || null
      persistProject()
      renderFaceSelection()
      refreshCode()
      setStatus(t('Faceを「{name}」へ切り替えました', { name: option.name }))
    })
    faceSelectionList.append(button)
  }
}

faceSelectionButton.addEventListener('click', (event) => {
  event.stopPropagation()
  setFaceSelectionMenuOpen(faceSelectionMenu.hidden, { focusItem: faceSelectionMenu.hidden })
})

async function openSelectedFaceEditor() {
  const assetPath = currentProject.settings.faceAsset
  const entry = currentProject.assets.find(
    (asset) => asset.path === assetPath && asset.mediaType === FACE_ASSET_MEDIA_TYPE
  )
  if (!entry) {
    setStatus('編集するカスタムFaceを選択してください')
    return
  }
  editFaceButton.disabled = true
  try {
    const asset = parseFaceAsset(new TextDecoder().decode(assetBytes(entry)))
    persistProject()
    if (!(await projectSave)) throw new Error(t('MODプロジェクトを保存できませんでした'))
    saveFaceEditContext(asset, { projectId: currentProject.id, assetPath: entry.path })
    location.href = '../face-editor/?face-edit=project'
  } catch (error) {
    log(`顔エディタを開けませんでした: ${error.message}`)
    setStatus(`顔エディタを開けませんでした: ${error.message}`)
    renderFaceSelection()
  }
}

editFaceButton.addEventListener('click', openSelectedFaceEditor)
faceEditorNavigationLink?.addEventListener('click', (event) => {
  const selectedFace = faceAssetEntries().some(({ asset }) => asset.path === currentProject.settings.faceAsset)
  if (!selectedFace) return
  event.preventDefault()
  document.getElementById('tool-drawer')?.close()
  void openSelectedFaceEditor()
})
window.addEventListener('pageshow', renderFaceSelection)
faceSelectionMenu.addEventListener('keydown', (event) => {
  const items = visibleFaceSelectionItems()
  const index = items.indexOf(document.activeElement)
  if (items.length === 0) return
  let nextIndex
  if (event.key === 'ArrowDown') nextIndex = index < 0 ? 0 : (index + 1) % items.length
  else if (event.key === 'ArrowUp') nextIndex = index < 0 ? items.length - 1 : (index - 1 + items.length) % items.length
  else if (event.key === 'Home') nextIndex = 0
  else if (event.key === 'End') nextIndex = items.length - 1
  else return
  event.preventDefault()
  items[nextIndex]?.focus()
})
document.addEventListener('click', (event) => {
  if (!faceSelectionMenu.hidden && !event.target.closest('.face-selection-control')) {
    setFaceSelectionMenuOpen(false)
  }
})
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || faceSelectionMenu.hidden) return
  setFaceSelectionMenuOpen(false)
  faceSelectionButton.focus()
})

function renderAssets() {
  renderFaceSelection()
  assetSummary.replaceChildren()
  if (currentProject.assets.length === 0) {
    assetSummary.textContent = t('アセットなし')
    return
  }
  for (const asset of currentProject.assets) {
    const chip = document.createElement('span')
    chip.className = 'asset-chip'
    const label = document.createElement('span')
    label.className = 'asset-chip-label'
    label.textContent = asset.path.replace(/^assets\//, '')
    label.title = label.textContent
    chip.append(label)
    const remove = document.createElement('button')
    remove.type = 'button'
    remove.textContent = '×'
    remove.title = t('{path}を削除', { path: asset.path })
    remove.addEventListener('click', () => {
      currentProject.assets = currentProject.assets.filter((candidate) => candidate.path !== asset.path)
      if (currentProject.settings.faceAsset === asset.path) currentProject.settings.faceAsset = null
      persistProject()
      renderAssets()
      refreshCode()
    })
    chip.append(remove)
    assetSummary.append(chip)
  }
}

function addFaceAsset(asset, options) {
  return addFaceAssetToProject(currentProject, asset, options)
}

try {
  if (new URLSearchParams(location.search).get('face-asset') === 'staging') {
    const stagedTransfer = loadStagedFaceTransfer()
    if (!stagedTransfer) throw new Error(t('顔エディタからの受け渡しデータがありません'))
    const edit = stagedTransfer.edit
    if (edit && edit.projectId !== currentProject.id) {
      throw new Error(t('編集元と現在のMODプロジェクトが一致しません'))
    }
    const stagedProject = addFaceAsset(stagedTransfer.asset, edit ? { replacePath: edit.assetPath } : undefined)
    persistProject(stagedProject)
    if (!(await projectSave)) throw new Error(t('顔アセットを含むMODプロジェクトを保存できませんでした'))
    clearStagedFaceTransfer()
    clearFaceEditContext()
    history.replaceState(null, '', location.pathname)
    setStatus(edit ? '顔エディタの変更を反映しました' : '顔エディタのアセットを追加しました')
  }
} catch (error) {
  log(`顔アセットを読み込めませんでした: ${error.message}`)
  setStatus(`顔アセットを読み込めませんでした: ${error.message}`)
}

function recordMetric(event, detail = {}) {
  try {
    const metrics = JSON.parse(localStorage.getItem(METRICS_STORAGE_KEY) ?? '[]')
    metrics.push({ event, at: new Date().toISOString(), project: currentProject.name, ...detail })
    localStorage.setItem(METRICS_STORAGE_KEY, JSON.stringify(metrics.slice(-200)))
  } catch {
    // 計測は編集やビルドを妨げない。
  }
}

recordMetric('editor_opened', { target: currentProject.target, browser: navigator.userAgent })

function renderAnalysis() {
  const workspaceAnalysis = analyzeWorkspace(workspaceState(), { target: targetDeviceSelect.value })
  currentAnalysis = currentGenerationError
    ? {
        ...workspaceAnalysis,
        canBuild: false,
        diagnostics: [
          ...workspaceAnalysis.diagnostics,
          {
            severity: 'error',
            code: 'VP_CODE_GENERATION_FAILED',
            message: t('コードを生成できません: {error}', { error: currentGenerationError }),
          },
        ],
      }
    : workspaceAnalysis
  diagnosticsList.replaceChildren()
  diagnosticsCount.textContent = String(currentAnalysis.diagnostics.length)

  for (const block of workspace.getAllBlocks(false)) block.setWarningText(null, 'visual-validator')
  for (const diagnostic of currentAnalysis.diagnostics) {
    const item = document.createElement('li')
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'diagnostic-button'
    button.dataset.severity = diagnostic.severity
    const code = document.createElement('span')
    code.className = 'diagnostic-code'
    code.textContent = `${t(diagnostic.severity === 'error' ? 'エラー' : '警告')} · ${diagnostic.code}`
    const diagnosticMessage = t(diagnostic.message)
    button.append(code, document.createTextNode(diagnosticMessage))
    if (diagnostic.blockId) {
      workspace.getBlockById(diagnostic.blockId)?.setWarningText(diagnosticMessage, 'visual-validator')
      button.addEventListener('click', () => {
        const block = workspace.getBlockById(diagnostic.blockId)
        if (!block) return
        workspace.centerOnBlock(block.id)
        block.select()
      })
    }
    item.append(button)
    diagnosticsList.append(item)
  }

  const profile = profileFor(targetDeviceSelect.value)
  const xsLabel = profile.xsArchiveVersion
    ? ` · XS ${profile.xsArchiveVersion.join('.')}`
    : ` · ${t('XS版は書き込み前に確認')}`
  const profileLabel = t(profile.label)
  capabilitySummary.textContent = currentAnalysis.requirements.length
    ? `${profileLabel}${xsLabel} · ${t('使用する能力: {requirements}', {
        requirements: currentAnalysis.requirements.join(', '),
      })}`
    : `${profileLabel}${xsLabel} · ${t('追加のハードウェア能力は使いません')}`
  capabilitySummary.dataset.severity = currentAnalysis.canBuild ? 'ok' : 'error'
  buildButton.disabled = !currentAnalysis.canBuild
}

function refreshCode() {
  currentArchive = null
  currentGenerationError = null
  downloadButton.disabled = true
  installSimulatorButton.disabled = true
  refreshDeviceActionButtons()
  try {
    const generatedSource = generateModSource(javascriptGenerator, workspace)
    const selectedFaceAsset = currentProject.assets.find((asset) => asset.path === currentProject.settings.faceAsset)
    const nextSource = selectedFaceAsset
      ? applyFaceAssetToSource(generatedSource, parseFaceAsset(new TextDecoder().decode(assetBytes(selectedFaceAsset))))
      : generatedSource
    currentSource = nextSource
    codePreview.textContent = currentSource
  } catch (error) {
    currentSource = ''
    currentGenerationError = String(error.message ?? error)
    codePreview.textContent = `// コード生成エラー: ${error.message}`
  }
  renderAnalysis()
}

workspace.addChangeListener((event) => {
  if (event.isUiEvent) return
  refreshCode()
  persistProject()
})
refreshCode()
renderAssets()
renderRecentProjects()
recoveryButton.hidden = !recoveryRecord
queueProjectSave()

for (const sample of VISUAL_SAMPLES) {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'sample-card'
  button.dataset.sampleId = sample.id
  const title = document.createElement('strong')
  title.textContent = t(sample.title)
  const description = document.createElement('span')
  description.textContent = t(sample.description)
  button.append(title, description)
  button.addEventListener('click', () => {
    loadWorkspace(sample.workspace)
    refreshCode()
    setStatus(t('サンプル「{title}」を読み込みました', { title: t(sample.title) }))
    recordMetric('sample_loaded', { sample: sample.id })
    sampleDialog.close()
  })
  sampleList.append(button)
}

sampleButton.addEventListener('click', () => sampleDialog.showModal())
sampleClose.addEventListener('click', () => sampleDialog.close())

clearButton.addEventListener('click', () => {
  clearWorkspaceProjectName.textContent = currentProject.name
  clearWorkspaceDialog.showModal()
})

clearWorkspaceConfirm.addEventListener('click', () => {
  workspace.clear()
  refreshCode()
  persistProject()
  setStatus(`「${currentProject.name}」のワークスペースを消去しました`)
  recordMetric('workspace_cleared')
})

targetDeviceSelect.addEventListener('change', () => {
  workspace.updateToolbox(toolboxForTarget(TOOLBOX, targetDeviceSelect.value))
  persistProject()
  refreshCode()
})

embedAssetsInput.addEventListener('change', () => {
  currentProject.settings.embedAssets = embedAssetsInput.checked
  persistProject()
  refreshCode()
})

newProjectButton.addEventListener('click', () => {
  persistProject()
  const sample = sampleById('hello')
  activateProject(createVisualProject({ workspace: sample.workspace }), '新しいプロジェクトを作成しました')
  recordMetric('project_created')
})

duplicateProjectButton.addEventListener('click', () => {
  persistProject()
  activateProject(duplicateVisualProject(currentProject), 'プロジェクトを複製しました')
  recordMetric('project_duplicated')
})

recoveryButton.addEventListener('click', () => {
  if (!recoveryRecord) return
  downloadBytes(
    `${JSON.stringify(recoveryRecord, null, 2)}\n`,
    `stackchan-project-recovery-${recoveryRecord.capturedAt.replace(/[:.]/g, '-')}.json`,
    'application/json'
  )
})

exportButton.addEventListener('click', () => {
  persistProject()
  const blob = new Blob([serializeVisualProject(currentProject)], { type: 'application/json' })
  downloadBlob(blob, projectFileName(currentProject))
  recordMetric('project_exported')
})

importButton.addEventListener('click', () => projectFileInput.click())
projectFileInput.addEventListener('change', async () => {
  const [file] = projectFileInput.files ?? []
  if (!file) return
  let raw = ''
  try {
    if (file.size > MAX_PROJECT_JSON_BYTES) {
      setStatus(`プロジェクトは${formatByteSize(MAX_PROJECT_JSON_BYTES)}以下にしてください`)
      return
    }
    raw = await file.text()
    const imported = parseVisualProject(raw)
    activateProject(imported, `「${imported.name}」を読み込みました`)
    recordMetric('project_imported')
  } catch (error) {
    recoveryRecord = createRecoveryRecord(raw, error)
    void projectStorage.saveRecovery(recoveryRecord).catch((storageError) => {
      log(`復旧データを保存できませんでした: ${storageError.message}`)
    })
    recoveryButton.hidden = false
    setStatus('プロジェクトを読み込めませんでした')
    log(String(error.message ?? error))
  } finally {
    projectFileInput.value = ''
  }
})

assetButton.addEventListener('click', () => assetFileInput.click())
assetFileInput.addEventListener('change', async () => {
  const files = [...(assetFileInput.files ?? [])]
  try {
    if (currentProject.assets.length + files.length > MAX_ASSET_COUNT) {
      setStatus(`アセットは${MAX_ASSET_COUNT}個まで追加できます`)
      return
    }
    let addedCount = 0
    for (const file of files) {
      if (file.size > MAX_ASSET_BYTES) {
        setStatus(`${file.name}は${formatByteSize(MAX_ASSET_BYTES)}以下にしてください`)
        continue
      }
      try {
        const bytes = new Uint8Array(await file.arrayBuffer())
        let binary = ''
        for (let offset = 0; offset < bytes.length; offset += 0x8000) {
          binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
        }
        let mediaType = file.type || 'application/octet-stream'
        let assetData = btoa(binary)
        let encoding = 'base64'
        if (file.type === FACE_ASSET_MEDIA_TYPE || file.name.toLowerCase().endsWith('.stackchan-face.json')) {
          const faceAsset = parseFaceAsset(new TextDecoder().decode(bytes))
          mediaType = FACE_ASSET_MEDIA_TYPE
          assetData = `${JSON.stringify(faceAsset, null, 2)}\n`
          encoding = 'utf8'
        }
        const asset = {
          path: `assets/${file.name.replace(/[^\p{L}\p{N}._-]/gu, '_')}`,
          mediaType,
          encoding,
          data: assetData,
        }
        const nextAssets = [...currentProject.assets.filter((item) => item.path !== asset.path), asset]
        const nextSettings = {
          ...currentProject.settings,
          faceAsset: mediaType === FACE_ASSET_MEDIA_TYPE ? asset.path : currentProject.settings.faceAsset,
        }
        serializeVisualProject({ ...currentProject, assets: nextAssets, settings: nextSettings })
        currentProject.assets = nextAssets
        currentProject.settings = nextSettings
        addedCount += 1
      } catch (error) {
        setStatus(`${file.name}をアセットとして読み込めませんでした`)
        log(String(error.message ?? error))
        recordMetric('asset_failed', { name: file.name, error: String(error.message ?? error) })
      }
    }
    persistProject()
    renderAssets()
    refreshCode()
    if (addedCount) recordMetric('assets_added', { count: addedCount })
  } finally {
    // Chromium may lazily read temporary File objects. Keep the selection
    // alive until every arrayBuffer() call has settled.
    assetFileInput.value = ''
  }
})

buildButton.addEventListener('click', async () => {
  refreshCode()
  if (!currentAnalysis.canBuild) {
    setStatus('ビルド前診断のエラーを修正してください')
    selectOutputTab(document.getElementById('diagnostics-tab'))
    return
  }
  buildButton.disabled = true
  setStatus('ビルド中… (mcrun @ WebAssembly)')
  currentArchive = null
  downloadButton.disabled = true
  installSimulatorButton.disabled = true
  installDeviceButton.disabled = true
  try {
    const startedAt = performance.now()
    const embeddedAssets = currentProject.settings.embedAssets ? currentProject.assets : []
    const archive = await buildModArchive(createTools, {
      modJs: currentSource,
      name: currentProject.name,
      manifest: manifestForProjectAssets(embeddedAssets),
      files: embeddedAssets.map((asset) => ({ path: asset.path, bytes: assetBytes(asset) })),
      onLog: log,
    })
    if (!isXsArchive(archive)) throw new Error('生成されたファイルがXSアーカイブではありません')
    currentArchive = archive
    const version = xsArchiveVersion(archive)
    const compatibility = inspectDeploymentCompatibility(targetDeviceSelect.value, { xsVersion: version })
    if (!compatibility.compatible) throw new Error(compatibility.diagnostics.map((item) => item.message).join('\n'))
    const elapsed = ((performance.now() - startedAt) / 1000).toFixed(1)
    setStatus(`ビルド成功: ${formatByteSize(archive.length)} / XS ${version?.join('.')} (${elapsed}秒)`)
    recordMetric('build_succeeded', { elapsedMs: Math.round(performance.now() - startedAt), size: archive.length })
    downloadButton.disabled = false
    installSimulatorButton.disabled = false
    refreshDeviceActionButtons()
    if (!('serial' in navigator)) log('このブラウザはWebSerialに対応していないため実機転送は使えません')
    else if (!profileFor(targetDeviceSelect.value).deviceInstall) {
      log(`${profileFor(targetDeviceSelect.value).label}はWebSerial実機書き込みの対象ではありません`)
    }
  } catch (error) {
    console.error(error)
    setStatus('ビルド失敗。ログを確認してください。')
    log(String(error.message ?? error))
    recordMetric('build_failed', { error: String(error.message ?? error) })
  } finally {
    buildButton.disabled = false
  }
})

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  // Chromium may resolve the Blob URL after click() returns. Revoking it in
  // the same task races the download and can produce an empty/missing file.
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

function downloadBytes(bytes, name, type = 'application/octet-stream') {
  downloadBlob(new Blob([bytes], { type }), name)
}

downloadButton.addEventListener('click', () => {
  if (!currentArchive) return
  downloadBytes(currentArchive, `${currentProject.name}.xsa`)
})

installSimulatorButton.addEventListener('click', async () => {
  if (!currentArchive) return
  try {
    const storage = createModStorage()
    const installed = await storage.saveInstalledMod({ name: `${currentProject.name}.xsa`, bytes: currentArchive })
    setStatus(`シミュレーターを起動しています (${formatByteSize(installed.size)})`)
    simulatorDialog.showModal()
    simulatorFrame.dataset.runCount = '0'
    simulatorFrame.src = `../simulator/?editor=${Date.now()}`
    simulatorMetricPending = true
    recordMetric('simulator_opened', { size: installed.size })
  } catch (error) {
    setStatus('シミュレータへの保存に失敗しました')
    log(String(error.message ?? error))
  }
})

function postSimulatorCommand(command, detail = {}) {
  simulatorFrame.contentWindow?.postMessage({ type: 'stackchan-editor-command', command, ...detail }, location.origin)
}

simulatorRestart.addEventListener('click', () => postSimulatorCommand('restart'))
simulatorStop.addEventListener('click', () => {
  simulatorMetricPending = false
  simulatorFrame.src = 'about:blank'
  simulatorFrame.dataset.runCount = '0'
  setStatus('シミュレーターを停止しました')
})
simulatorClose.addEventListener('click', () => {
  simulatorMetricPending = false
  simulatorDialog.close()
  simulatorFrame.src = 'about:blank'
})
for (const button of document.querySelectorAll('[data-simulator-button]')) {
  button.addEventListener('click', () => postSimulatorCommand('button', { name: button.dataset.simulatorButton }))
}

window.addEventListener('message', (event) => {
  if (event.origin !== location.origin || event.source !== simulatorFrame.contentWindow) return
  if (!simulatorDialog.open) return
  const message = event.data
  if (message?.type === 'stackchan-simulator-ready') {
    simulatorFrame.dataset.runCount = String(message.runCount ?? 1)
    setStatus(
      message.runCount > 1
        ? `シミュレーターでMODを再実行しました（${message.runCount}回目）`
        : 'シミュレーターでMODを実行しています'
    )
    if (simulatorMetricPending) {
      simulatorMetricPending = false
      recordMetric('simulator_succeeded', { size: currentArchive?.length ?? null })
    }
    return
  }
  if (message?.type === 'stackchan-simulator-trace') {
    const text = String(message.text ?? '')
    log(`[simulator] ${text}`)
    const runtimeDiagnostic = parseVisualTrace(text)
    const blockId = runtimeDiagnostic?.block_id
    const block = blockId ? workspace.getBlockById(blockId) : null
    if (block) {
      block.setWarningText(`${runtimeDiagnostic.error_code}: ${runtimeDiagnostic.message}`, 'visual-runtime')
      workspace.centerOnBlock(block.id)
      block.select()
      selectOutputTab(document.getElementById('log-tab'))
    }
  }
  if (message?.type === 'stackchan-simulator-status' && message.status === 'error') {
    setStatus(`シミュレーターエラー: ${message.error}`)
  }
})

async function writeArchiveToDevice(archive) {
  if (!profileFor(targetDeviceSelect.value).deviceInstall) {
    setStatus(
      t('{profile}は実機書き込みの対象ではありません', {
        profile: t(profileFor(targetDeviceSelect.value).label),
      })
    )
    return
  }
  if (!('serial' in navigator)) {
    setStatus('このブラウザはWebSerialに対応していません (Chrome/Edgeを使ってください)')
    return
  }
  deviceOperationPending = true
  refreshDeviceActionButtons()
  installProgress.hidden = false
  installProgress.value = 0
  let port
  try {
    port = await navigator.serial.requestPort()
    setStatus('実機へ書き込み中…（ブートローダ経由でxsパーティションへ）')
    const result = await installModToDevice(createEsptoolLoader, port, archive, {
      onLog: log,
      onProgress: (ratio) => {
        installProgress.value = ratio
      },
      onPrompt: (message) => setStatus(message),
      onPreflight: ({ chip, firmware }) => {
        const archiveVersion = xsArchiveVersion(archive)
        const compatibility = inspectDeploymentCompatibility(targetDeviceSelect.value, {
          chip,
          xsVersion: archiveVersion,
          firmwareVersion: firmware.version,
          requireFirmware: true,
          requireArchive: true,
        })
        if (!compatibility.compatible) {
          throw new Error(
            `安全確認で不一致を検出したため書き込みません: ${compatibility.diagnostics
              .map((item) => item.message)
              .join(' / ')}`
          )
        }
        log(
          `[flash] 互換性を確認しました: ${chip} / ${firmware.projectName} ${firmware.version} / XS ${archiveVersion.join('.')}`
        )
        return true
      },
    })
    if (result.status === DEVICE_OPERATION_STATUS.CANCELLED) {
      setStatus('実機への書き込みをキャンセルしました')
      return
    }
    setStatus(`実機への書き込みと検証が終了しました (${result.chip})`)
    recordMetric('device_installed', { size: archive.length, target: targetDeviceSelect.value })
  } catch (error) {
    console.error(error)
    setStatus('実機への書き込みに失敗しました。ログを確認してください。')
    log(String(error.message ?? error))
    recordMetric('device_failed', { error: String(error.message ?? error) })
  } finally {
    installProgress.hidden = true
    deviceOperationPending = false
    refreshDeviceActionButtons()
  }
}

installDeviceButton.addEventListener('click', async () => {
  if (currentArchive) await writeArchiveToDevice(currentArchive)
})

removeDeviceButton.addEventListener('click', async () => {
  if (!profileFor(targetDeviceSelect.value).deviceInstall) {
    setStatus(
      t('{profile}は実機操作の対象ではありません', {
        profile: t(profileFor(targetDeviceSelect.value).label),
      })
    )
    return
  }
  if (!('serial' in navigator)) {
    setStatus('このブラウザはWebSerialに対応していません')
    return
  }
  let port
  try {
    deviceOperationPending = true
    refreshDeviceActionButtons()
    port = await navigator.serial.requestPort()
    const result = await removeModFromDevice(createEsptoolLoader, port, {
      onLog: log,
      onPrompt: (message) => setStatus(message),
      onPreflight: ({ chip, partition, firmware }) => {
        const compatibility = inspectDeploymentCompatibility(targetDeviceSelect.value, {
          chip,
          firmwareVersion: firmware.version,
          requireFirmware: true,
        })
        if (!compatibility.compatible) {
          throw new Error(
            `安全確認で不一致を検出したため削除しません: ${compatibility.diagnostics
              .map((item) => item.message)
              .join(' / ')}`
          )
        }
        return globalThis.confirm(
          t(
            '{profile}（{chip} / {firmwareVersion}）のxsパーティション（{offset}）からMODを削除します。続行しますか？',
            {
              profile: t(profileFor(targetDeviceSelect.value).label),
              chip,
              firmwareVersion: firmware.version,
              offset: `0x${partition.offset.toString(16)}`,
            }
          )
        )
      },
    })
    if (result.status === DEVICE_OPERATION_STATUS.CANCELLED) {
      setStatus('実機のMOD削除をキャンセルしました')
      return
    }
    setStatus('実機のMODを削除しました')
    recordMetric('device_mod_removed')
  } catch (error) {
    setStatus('実機のMODを削除できませんでした')
    log(String(error.message ?? error))
    recordMetric('device_remove_failed', { error: String(error.message ?? error) })
  } finally {
    deviceOperationPending = false
    refreshDeviceActionButtons()
  }
})

try {
  const linkedProjectUrl = projectUrlFromSearch(location.search, location.href)
  if (linkedProjectUrl) {
    const linkedProject = await fetchExternalProject(linkedProjectUrl)
    activateProject(linkedProject, `Galleryから「${linkedProject.name}」を読み込みました`)
    history.replaceState(null, '', location.pathname)
    recordMetric('gallery_project_loaded', { source: linkedProjectUrl.pathname })
  }
} catch (error) {
  setStatus(`Galleryのプロジェクトを読み込めませんでした: ${error.message}`)
  log(String(error.message ?? error))
}
