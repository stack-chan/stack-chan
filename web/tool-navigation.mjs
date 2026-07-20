export const TOOL_NAVIGATION_ITEMS = Object.freeze([
  { id: 'home', href: '', label: 'ホーム', description: 'Webツールの一覧', icon: 'home' },
  {
    id: 'flash',
    href: 'flash/',
    label: 'ファームウェア書き込み',
    description: 'USBで対応ボードへ書き込む',
    icon: 'cpu',
  },
  {
    id: 'preference',
    href: 'preference/',
    label: '設定',
    description: 'BLEで本体の設定を変更する',
    icon: 'sliders-horizontal',
  },
  {
    id: 'mod-gallery',
    href: 'mod-gallery/',
    label: 'MOD Gallery',
    description: '公開済みMODを試して編集する',
    icon: 'store',
  },
  {
    id: 'simulator',
    href: 'simulator/',
    label: 'シミュレーター',
    description: 'WASMと3Dモデルを実行する',
    icon: 'box',
  },
  {
    id: 'editor',
    href: 'editor/',
    label: 'ブロックエディタ',
    description: 'BlocklyからMODを作成する',
    icon: 'blocks',
  },
  {
    id: 'face-editor',
    href: 'face-editor/',
    label: 'Shape顔エディタ',
    description: 'Shape型Faceを設計する',
    icon: 'smile',
  },
])

export const GUIDE_NAVIGATION_ITEMS = Object.freeze([
  {
    id: 'tutorial',
    href: 'editor/tutorial.html',
    label: 'ブロックエディタ チュートリアル',
    description: '作成から実行までの手順',
    icon: 'circle-help',
  },
])

export function navigationItemForPath(pathname) {
  const normalized = String(pathname || '/').replace(/\/index\.html$/, '/')
  if (/\/editor\/tutorial\.html$/.test(normalized)) return 'tutorial'
  if (/\/face-editor\/?$/.test(normalized)) return 'face-editor'
  if (/\/editor\/?$/.test(normalized)) return 'editor'
  if (/\/mod-gallery\/?$/.test(normalized)) return 'mod-gallery'
  if (/\/simulator\/?$/.test(normalized)) return 'simulator'
  if (/\/preference\/?$/.test(normalized)) return 'preference'
  if (/\/flash\/?$/.test(normalized)) return 'flash'
  return 'home'
}

function navigationLink(item, rootUrl, currentId) {
  const anchor = document.createElement('a')
  anchor.className = 'tool-drawer-link'
  anchor.dataset.toolId = item.id
  anchor.href = new URL(item.href, rootUrl).href
  if (item.id === currentId) anchor.setAttribute('aria-current', 'page')

  const icon = document.createElement('i')
  icon.dataset.lucide = item.icon
  icon.setAttribute('aria-hidden', 'true')

  const copy = document.createElement('span')
  const label = document.createElement('strong')
  label.textContent = item.label
  const description = document.createElement('small')
  description.textContent = item.description
  copy.append(label, description)
  anchor.append(icon, copy)
  return anchor
}

function navigationSection(title, items, rootUrl, currentId) {
  const section = document.createElement('section')
  section.className = 'tool-drawer-section'
  const heading = document.createElement('h2')
  heading.textContent = title
  const nav = document.createElement('nav')
  nav.setAttribute('aria-label', title)
  for (const item of items) nav.append(navigationLink(item, rootUrl, currentId))
  section.append(heading, nav)
  return section
}

export function installToolNavigation({
  topbar = document.querySelector('.topbar'),
  pathname = location.pathname,
  rootUrl = new URL('./', import.meta.url),
} = {}) {
  if (!topbar || topbar.querySelector('.tool-menu-button')) return null

  topbar.querySelector('.tool-nav')?.remove()

  const button = document.createElement('button')
  button.className = 'icon-button tool-menu-button'
  button.type = 'button'
  button.title = 'ツールメニュー'
  button.setAttribute('aria-label', 'ツールメニューを開く')
  button.setAttribute('aria-haspopup', 'dialog')
  button.setAttribute('aria-controls', 'tool-drawer')
  button.innerHTML = '<i data-lucide="menu" aria-hidden="true"></i>'
  topbar.prepend(button)

  const dialog = document.createElement('dialog')
  dialog.id = 'tool-drawer'
  dialog.className = 'tool-drawer'
  dialog.setAttribute('aria-labelledby', 'tool-drawer-title')

  const panel = document.createElement('div')
  panel.className = 'tool-drawer-panel'
  const header = document.createElement('header')
  const titleGroup = document.createElement('div')
  const eyebrow = document.createElement('span')
  eyebrow.className = 'tool-drawer-eyebrow'
  eyebrow.textContent = 'Stack-chan'
  const title = document.createElement('h1')
  title.id = 'tool-drawer-title'
  title.textContent = 'Webツール'
  titleGroup.append(eyebrow, title)

  const close = document.createElement('button')
  close.className = 'icon-button'
  close.type = 'button'
  close.setAttribute('aria-label', 'ツールメニューを閉じる')
  close.innerHTML = '<i data-lucide="x" aria-hidden="true"></i>'
  header.append(titleGroup, close)

  const currentId = navigationItemForPath(pathname)
  const content = document.createElement('div')
  content.className = 'tool-drawer-content'
  content.append(
    navigationSection('ツール', TOOL_NAVIGATION_ITEMS, rootUrl, currentId),
    navigationSection('ガイド', GUIDE_NAVIGATION_ITEMS, rootUrl, currentId)
  )
  panel.append(header, content)
  dialog.append(panel)
  document.body.append(dialog)

  const open = () => {
    dialog.showModal()
    dialog.querySelector('[aria-current="page"]')?.focus()
  }
  const closeDialog = () => dialog.close()
  button.addEventListener('click', open)
  close.addEventListener('click', closeDialog)
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) closeDialog()
  })
  dialog.addEventListener('close', () => button.focus())

  globalThis.lucide?.createIcons()
  return { button, dialog, open, close: closeDialog }
}

if (typeof document !== 'undefined') installToolNavigation()
