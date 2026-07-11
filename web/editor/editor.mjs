import { registerStackchanBlocks, TOOLBOX, generateModSource } from './blocks.mjs'
import { buildModArchive, isXsArchive, xsArchiveVersion } from './mod-builder.mjs'
import { installModToDevice, createEsptoolLoader } from './esptool-installer.mjs'
import { createModStorage, formatByteSize } from '../simulator/mod-storage.mjs'
import createTools from './vendor/tools.js'

const WORKSPACE_STORAGE_KEY = 'stackchan-blockly-workspace'
const MOD_NAME = 'blockly-mod'

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

const logLines = []
function log(text) {
  logLines.push(String(text))
  if (logLines.length > 400) logLines.splice(0, logLines.length - 400)
  logOutput.textContent = logLines.join('\n')
  logOutput.scrollTop = logOutput.scrollHeight
}

function setStatus(text) {
  buildStatus.textContent = text
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

if (!Blockly || !javascriptGenerator) {
  setStatus('Blocklyを読み込めませんでした。ネットワーク接続を確認してください。')
  throw new Error('Blockly failed to load')
}

registerStackchanBlocks(Blockly, javascriptGenerator, Order)
javascriptGenerator.INFINITE_LOOP_TRAP = null
javascriptGenerator.addReservedWords('robot,Timer,Emotion,wait,randomBetween,hexToRgb,trace')

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

try {
  const saved = localStorage.getItem(WORKSPACE_STORAGE_KEY)
  if (saved) loadWorkspace(JSON.parse(saved))
  else loadWorkspace(SAMPLE_WORKSPACE)
} catch (error) {
  log(`ワークスペースの復元に失敗しました: ${error.message}`)
  loadWorkspace(SAMPLE_WORKSPACE)
}

let currentSource = ''
let currentArchive = null

function refreshCode() {
  try {
    currentSource = generateModSource(javascriptGenerator, workspace)
    codePreview.textContent = currentSource
  } catch (error) {
    codePreview.textContent = `// コード生成エラー: ${error.message}`
  }
}

workspace.addChangeListener((event) => {
  if (event.isUiEvent) return
  refreshCode()
  try {
    const state = Blockly.serialization.workspaces.save(workspace)
    localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(state))
  } catch {
    // localStorage may be unavailable (private mode); the editor still works
  }
})
refreshCode()

sampleButton.addEventListener('click', () => {
  loadWorkspace(SAMPLE_WORKSPACE)
  refreshCode()
})

clearButton.addEventListener('click', () => {
  workspace.clear()
  refreshCode()
})

buildButton.addEventListener('click', async () => {
  buildButton.disabled = true
  setStatus('ビルド中… (mcrun @ WebAssembly)')
  currentArchive = null
  downloadButton.disabled = true
  installSimulatorButton.disabled = true
  installDeviceButton.disabled = true
  try {
    const startedAt = performance.now()
    const archive = await buildModArchive(createTools, {
      modJs: currentSource,
      name: MOD_NAME,
      onLog: log,
    })
    if (!isXsArchive(archive)) throw new Error('生成されたファイルがXSアーカイブではありません')
    currentArchive = archive
    const version = xsArchiveVersion(archive)
    const elapsed = ((performance.now() - startedAt) / 1000).toFixed(1)
    setStatus(`ビルド成功: ${formatByteSize(archive.length)} / XS ${version?.join('.')} (${elapsed}秒)`)
    downloadButton.disabled = false
    installSimulatorButton.disabled = false
    installDeviceButton.disabled = !('serial' in navigator)
    if (!('serial' in navigator)) log('このブラウザはWebSerialに対応していないため実機転送は使えません')
  } catch (error) {
    console.error(error)
    setStatus('ビルド失敗。ログを確認してください。')
    log(String(error.message ?? error))
  } finally {
    buildButton.disabled = false
  }
})

downloadButton.addEventListener('click', () => {
  if (!currentArchive) return
  const blob = new Blob([currentArchive], { type: 'application/octet-stream' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${MOD_NAME}.xsa`
  anchor.click()
  URL.revokeObjectURL(url)
})

installSimulatorButton.addEventListener('click', async () => {
  if (!currentArchive) return
  try {
    const storage = createModStorage()
    const installed = await storage.saveInstalledMod({ name: `${MOD_NAME}.xsa`, bytes: currentArchive })
    setStatus(`シミュレータ用に保存しました (${formatByteSize(installed.size)})`)
    log('シミュレータページを開いて「Restart simulator」を押すとMODが起動します')
    window.open('../simulator/', 'stackchan-simulator')
  } catch (error) {
    setStatus('シミュレータへの保存に失敗しました')
    log(String(error.message ?? error))
  }
})

installDeviceButton.addEventListener('click', async () => {
  if (!currentArchive) return
  if (!('serial' in navigator)) {
    setStatus('このブラウザはWebSerialに対応していません (Chrome/Edgeを使ってください)')
    return
  }
  installDeviceButton.disabled = true
  installProgress.hidden = false
  installProgress.value = 0
  let port
  try {
    port = await navigator.serial.requestPort()
    setStatus('実機へ書き込み中…（ブートローダ経由でxsパーティションへ）')
    await installModToDevice(createEsptoolLoader, port, currentArchive, {
      onLog: log,
      onProgress: (ratio) => {
        installProgress.value = ratio
      },
      onPrompt: (message) => setStatus(message),
    })
  } catch (error) {
    console.error(error)
    setStatus('実機への書き込みに失敗しました。ログを確認してください。')
    log(String(error.message ?? error))
  } finally {
    installProgress.hidden = true
    installDeviceButton.disabled = false
  }
})
