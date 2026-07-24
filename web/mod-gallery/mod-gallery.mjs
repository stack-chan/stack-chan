import { inspectDeploymentCompatibility, profileFor } from '../editor/capabilities.mjs'
import { createEsptoolLoader, DEVICE_OPERATION_STATUS, installModToDevice } from '../editor/esptool-installer.mjs'
import { xsArchiveVersion } from '../editor/mod-builder.mjs'
import { createModStorage } from '../simulator/mod-storage.mjs'
import { loadModCatalog } from './mod-definition.mjs'

const list = document.getElementById('mod-list')
const count = document.getElementById('gallery-count')
const empty = document.getElementById('gallery-empty')
const status = document.getElementById('gallery-status')
const search = document.getElementById('mod-search')
const typeFilter = document.getElementById('type-filter')

let definitions = []
let requestedMod = new URL(location.href).searchParams.get('mod')

function setStatus(message = '') {
  status.textContent = message
}

function typeLabel(type) {
  return type === 'block' ? 'ブロック' : 'テキスト'
}

function targetLabel(target) {
  return profileFor(target).label
}

async function fetchArchive(artifact) {
  const response = await fetch(artifact.url)
  if (!response.ok) throw new Error(`MODを取得できませんでした (${response.status})`)
  return new Uint8Array(await response.arrayBuffer())
}

async function installToSimulator(definition, artifact) {
  setStatus(`「${definition.name}」を準備しています`)
  const bytes = await fetchArchive(artifact)
  const compatibility = inspectDeploymentCompatibility('simulator', {
    xsVersion: xsArchiveVersion(bytes),
    requireArchive: true,
  })
  if (!compatibility.compatible) {
    throw new Error(compatibility.diagnostics.map((item) => item.message).join(' / '))
  }
  await createModStorage().saveInstalledMod({ name: `${definition.id}.xsa`, bytes })
  location.href = `../simulator/?gallery=${encodeURIComponent(definition.id)}`
}

async function installToDevice(definition, artifact) {
  if (!('serial' in navigator)) throw new Error('実機への書き込みにはChromeまたはEdgeを使ってください')
  const bytes = await fetchArchive(artifact)
  const archiveVersion = xsArchiveVersion(bytes)
  const port = await navigator.serial.requestPort()
  setStatus(`「${definition.name}」を実機へ書き込んでいます`)
  const result = await installModToDevice(createEsptoolLoader, port, bytes, {
    onPrompt: setStatus,
    onPreflight: ({ chip, firmware }) => {
      const compatibility = inspectDeploymentCompatibility(artifact.target, {
        chip,
        xsVersion: archiveVersion,
        firmwareVersion: firmware.version,
        requireArchive: true,
        requireFirmware: true,
      })
      if (!compatibility.compatible) {
        throw new Error(compatibility.diagnostics.map((item) => item.message).join(' / '))
      }
      return true
    },
  })
  if (result.status === DEVICE_OPERATION_STATUS.CANCELLED) {
    setStatus(`「${definition.name}」の書き込みをキャンセルしました`)
    return
  }
  setStatus(`「${definition.name}」を実機へ書き込みました`)
}

function actionButton(label, icon, action, className = '') {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = className
  const iconElement = document.createElement('i')
  iconElement.dataset.lucide = icon
  const copy = document.createElement('span')
  copy.textContent = label
  button.append(iconElement, copy)
  button.addEventListener('click', async () => {
    button.disabled = true
    setStatus()
    try {
      await action()
    } catch (error) {
      setStatus(error.message ?? String(error))
    } finally {
      button.disabled = false
    }
  })
  return button
}

function linkAction(label, icon, href, className = '') {
  const anchor = document.createElement('a')
  anchor.className = `button ${className}`.trim()
  anchor.href = href
  const iconElement = document.createElement('i')
  iconElement.dataset.lucide = icon
  const copy = document.createElement('span')
  copy.textContent = label
  anchor.append(iconElement, copy)
  return anchor
}

function renderCard(definition) {
  const card = document.createElement('article')
  card.className = 'mod-card'
  card.dataset.modId = definition.id
  card.dataset.modType = definition.type

  const header = document.createElement('header')
  header.className = 'mod-card-header'
  const heading = document.createElement('div')
  const title = document.createElement('h2')
  title.textContent = definition.name
  const version = document.createElement('div')
  version.className = 'mod-version'
  version.textContent = `v${definition.version} · ${definition.author ?? '作者不明'}`
  heading.append(title, version)
  const type = document.createElement('span')
  type.className = 'mod-type'
  type.dataset.type = definition.type
  type.textContent = typeLabel(definition.type)
  header.append(heading, type)

  const description = document.createElement('p')
  description.className = 'mod-description'
  description.textContent = definition.description

  const capabilities = document.createElement('div')
  capabilities.className = 'mod-capabilities'
  for (const capability of definition.capabilities) {
    const badge = document.createElement('span')
    badge.className = 'mod-capability'
    badge.textContent = capability
    capabilities.append(badge)
  }
  for (const target of definition.targets) {
    const badge = document.createElement('span')
    badge.className = 'mod-capability'
    badge.textContent = targetLabel(target)
    capabilities.append(badge)
  }

  const actions = document.createElement('div')
  actions.className = 'mod-actions'
  if (definition.type === 'block') {
    const editorUrl = new URL('../editor/', import.meta.url)
    editorUrl.searchParams.set('project', definition.sourceUrl.href)
    actions.append(linkAction('ブロックで開く', 'blocks', editorUrl.href, 'primary-button'))
  } else {
    const artifact = definition.artifacts[0]
    if (artifact) {
      const supportsSimulator = definition.targets.includes('simulator')
      if (supportsSimulator) {
        actions.append(
          actionButton('シミュレーターで試す', 'play', () => installToSimulator(definition, artifact), 'primary-button')
        )
      }
      actions.append(
        actionButton(
          '実機へ書き込む',
          'usb',
          () => installToDevice(definition, artifact),
          supportsSimulator ? '' : 'primary-button'
        )
      )
    }
    actions.append(linkAction('ソースを見る', 'file-code-2', definition.sourceUrl.href))
  }
  card.append(header, description, capabilities, actions)
  return card
}

function render() {
  const query = search.value.trim().toLocaleLowerCase('ja')
  const selectedType = typeFilter.value
  const visible = definitions.filter((definition) => {
    const matchesType = selectedType === 'all' || definition.type === selectedType
    const haystack = [definition.name, definition.description, ...definition.capabilities]
      .join(' ')
      .toLocaleLowerCase('ja')
    return matchesType && (!query || haystack.includes(query))
  })
  list.replaceChildren(...visible.map(renderCard))
  count.textContent = `${visible.length}件のMOD`
  empty.hidden = visible.length !== 0
  globalThis.lucide?.createIcons()
  if (requestedMod) {
    const card = [...list.querySelectorAll('.mod-card')].find((candidate) => candidate.dataset.modId === requestedMod)
    if (card) {
      card.classList.add('mod-card-selected')
      card.tabIndex = -1
      card.focus({ preventScroll: true })
      card.scrollIntoView({ behavior: 'smooth', block: 'center' })
      requestedMod = undefined
    }
  }
}

search.addEventListener('input', render)
typeFilter.addEventListener('change', render)

try {
  definitions = await loadModCatalog('./catalog.json')
  render()
} catch (error) {
  count.textContent = 'MODを読み込めませんでした'
  setStatus(`Galleryの読み込みに失敗しました: ${error.message}`)
}
