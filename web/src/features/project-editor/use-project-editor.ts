import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useI18n } from '@/app/i18n-provider'
import { type OperationState } from '@/features/operations/operation-state'
import {
  type BlocklyWorkspaceController,
  type BlocklyWorkspaceSnapshot,
} from '@/features/project-editor/blockly-workspace'
import { type ProjectAnalysis, type ProjectAsset, type VisualProject } from '@/features/project-editor/project-types'
import { useLogBuffer } from '@/hooks/use-log-buffer'
import { toAppError } from '@/lib/errors/app-error'
import { buildVisualProjectMod, type ModBuildResult } from '@/services/mod-builder/mod-build-service'
import { DEVICE_OPERATION_STATUS, installModToDevice, removeModFromDevice } from '../../../editor/esptool-installer.mjs'
import { createEsptoolLoader } from '../../../editor/esptool-installer.mjs'
import {
  addFaceAssetToProject,
  applyFaceAssetToSource,
  FACE_ASSET_MEDIA_TYPE,
  parseFaceAsset,
} from '../../../editor/face-assets.mjs'
import {
  assetBytes,
  createVisualProject,
  MAX_ASSET_BYTES,
  MAX_ASSET_COUNT,
  MAX_PROJECT_JSON_BYTES,
  parseVisualProject,
  projectFileName,
  serializeVisualProject,
} from '../../../editor/project-format.mjs'
import { duplicateVisualProject, updateProjectLibrary } from '../../../editor/project-library.mjs'
import { createProjectStorage } from '../../../editor/project-storage.mjs'
import { analyzeWorkspace } from '../../../editor/project-validator.mjs'
import { sampleById, VISUAL_SAMPLES } from '../../../editor/samples.mjs'
import { inspectDeploymentCompatibility, profileFor } from '../../../editor/capabilities.mjs'
import {
  clearFaceEditContext,
  clearStagedFaceTransfer,
  loadStagedFaceTransfer,
  saveFaceEditContext,
} from '../../../face-editor/face-editor-storage.mjs'
import { createModStorage, formatByteSize } from '../../../simulator/mod-storage.mjs'

const PROJECT_STORAGE_KEY = 'stackchan-visual-project-v1'

const makeVisualProject = createVisualProject as unknown as (
  options: Partial<VisualProject> & { workspace: Record<string, unknown> }
) => VisualProject
const addFaceToProject = addFaceAssetToProject as unknown as (
  project: VisualProject,
  asset: unknown,
  options?: { replacePath?: string | null }
) => VisualProject
const inspectCompatibility = inspectDeploymentCompatibility as unknown as (
  target: string,
  options: {
    chip?: string
    xsVersion?: number[] | null
    firmwareVersion?: string
    requireFirmware?: boolean
    requireArchive?: boolean
  }
) => { compatible: boolean; diagnostics: { message: string }[] }
const installDeviceArchive = installModToDevice as unknown as (
  loaderFactory: typeof createEsptoolLoader,
  port: unknown,
  archive: Uint8Array,
  options: Record<string, unknown>
) => Promise<Record<string, unknown> & { status: string; chip?: string }>
const removeDeviceArchive = removeModFromDevice as unknown as (
  loaderFactory: typeof createEsptoolLoader,
  port: unknown,
  options: Record<string, unknown>
) => Promise<Record<string, unknown> & { status: string }>

type Confirmation = {
  title: string
  description: string
  confirmLabel: string
  resolve: (approved: boolean) => void
}

type SerialNavigator = Navigator & {
  serial?: {
    requestPort: () => Promise<unknown>
  }
}

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

function sourceForProject(project: VisualProject, generatedSource: string) {
  const path = project.settings.faceAsset
  const selected = project.assets.find((asset) => asset.path === path)
  if (!selected) return generatedSource
  return applyFaceAssetToSource(generatedSource, parseFaceAsset(new TextDecoder().decode(assetBytes(selected))))
}

export function useProjectEditor() {
  const { locale, t } = useI18n()
  const storageRef = useRef(createProjectStorage())
  const saveQueueRef = useRef(Promise.resolve())
  const projectRef = useRef<VisualProject | null>(null)
  const projectsRef = useRef<VisualProject[]>([])
  const workspaceRef = useRef<BlocklyWorkspaceController | null>(null)
  const confirmationRef = useRef<Confirmation | null>(null)
  const simulatorFrameRef = useRef<HTMLIFrameElement>(null)
  const [project, setProject] = useState<VisualProject | null>(null)
  const [projects, setProjects] = useState<VisualProject[]>([])
  const [snapshot, setSnapshot] = useState<BlocklyWorkspaceSnapshot | null>(null)
  const [source, setSource] = useState('')
  const [analysis, setAnalysis] = useState<ProjectAnalysis>({
    requirements: [],
    diagnostics: [],
    canBuild: false,
  })
  const [buildOperation, setBuildOperation] = useState<OperationState<ModBuildResult>>({
    status: 'idle',
  })
  const [deviceOperation, setDeviceOperation] = useState<OperationState>({
    status: 'idle',
  })
  const [archive, setArchive] = useState<Uint8Array | null>(null)
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)
  const [simulatorOpen, setSimulatorOpen] = useState(false)
  const [simulatorSrc, setSimulatorSrc] = useState('about:blank')
  const { entries: logs, append: appendLog, clear: clearLogs } = useLogBuffer()

  const persistProject = useCallback(
    (next: VisualProject) => {
      projectRef.current = next
      const library = updateProjectLibrary(projectsRef.current, next) as VisualProject[]
      projectsRef.current = library
      setProject(next)
      setProjects(library)
      try {
        localStorage.setItem(PROJECT_STORAGE_KEY, serializeVisualProject(next))
      } catch (error) {
        appendLog(`ブラウザー保存を更新できませんでした: ${String(error)}`, 'warning', 'system')
      }
      const state = structuredClone({ currentProject: next, projects: library })
      saveQueueRef.current = saveQueueRef.current
        .then(() => storageRef.current.saveState(state))
        .catch((error) => {
          appendLog(`プロジェクトを自動保存できませんでした: ${String(error)}`, 'error', 'system')
        })
    },
    [appendLog]
  )

  const recalculate = useCallback((nextProject: VisualProject, nextSnapshot: BlocklyWorkspaceSnapshot) => {
    setSnapshot(nextSnapshot)
    let nextSource = nextSnapshot.source
    let generationError = nextSnapshot.generationError
    try {
      nextSource = sourceForProject(nextProject, nextSnapshot.source)
    } catch (error) {
      generationError = String(error instanceof Error ? error.message : error)
      nextSource = ''
    }
    setSource(nextSource)
    const workspaceAnalysis = analyzeWorkspace(nextSnapshot.workspace, {
      target: nextProject.target,
    }) as ProjectAnalysis
    if (generationError) {
      workspaceAnalysis.canBuild = false
      workspaceAnalysis.diagnostics = [
        {
          severity: 'error',
          code: 'VP_GENERATION',
          message: generationError,
        },
        ...workspaceAnalysis.diagnostics,
      ]
    }
    setAnalysis(workspaceAnalysis)
    setArchive(null)
    setBuildOperation({ status: 'idle' })
  }, [])

  useEffect(() => {
    let active = true
    const load = async () => {
      let current: VisualProject | null = null
      let library: VisualProject[] = []
      try {
        const stored = await storageRef.current.loadState()
        current = (stored?.currentProject as VisualProject | undefined) ?? null
        library = (stored?.projects as VisualProject[] | undefined) ?? []
      } catch (error) {
        appendLog(`保存したプロジェクトを復元できませんでした: ${String(error)}`, 'error', 'system')
      }
      if (!current) {
        try {
          const legacy = localStorage.getItem(PROJECT_STORAGE_KEY)
          if (legacy) current = parseVisualProject(legacy) as VisualProject
        } catch (error) {
          appendLog(`旧形式の保存データを復元できませんでした: ${String(error)}`, 'warning', 'system')
        }
      }
      current ??= makeVisualProject({ workspace: sampleById('hello').workspace })

      try {
        if (new URLSearchParams(location.search).get('face-asset') === 'staging') {
          const transfer = loadStagedFaceTransfer()
          if (!transfer) throw new Error('顔エディタからの受け渡しデータがありません')
          if (transfer.edit && transfer.edit.projectId !== current.id) {
            throw new Error('編集元と現在のMODプロジェクトが一致しません')
          }
          current = addFaceToProject(
            current,
            transfer.asset,
            transfer.edit ? { replacePath: transfer.edit.assetPath } : undefined
          ) as VisualProject
          clearStagedFaceTransfer()
          clearFaceEditContext()
          history.replaceState(null, '', location.pathname)
        }
      } catch (error) {
        appendLog(`顔アセットを反映できませんでした: ${String(error)}`, 'error', 'system')
      }
      if (!active) return
      projectRef.current = current
      library = updateProjectLibrary(library, current) as VisualProject[]
      projectsRef.current = library
      setProject(current)
      setProjects(library)
    }
    void load()
    return () => {
      active = false
    }
  }, [appendLog])

  useEffect(
    () => () => {
      confirmationRef.current?.resolve(false)
    },
    []
  )

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.origin !== location.origin || event.source !== simulatorFrameRef.current?.contentWindow) return
      const message = event.data
      if (message?.type === 'stackchan-simulator-trace') {
        appendLog(String(message.text ?? ''), 'trace', 'simulator')
      } else if (message?.type === 'stackchan-simulator-ready') {
        setBuildOperation((current) =>
          current.status === 'success'
            ? {
                ...current,
                message:
                  message.runCount > 1
                    ? `シミュレーターでMODを再実行しました（${message.runCount}回目）`
                    : 'シミュレーターでMODを実行しています',
              }
            : current
        )
      } else if (message?.type === 'stackchan-simulator-status' && message.status === 'error') {
        appendLog(String(message.error ?? 'シミュレーターエラー'), 'error', 'simulator')
      }
    }
    window.addEventListener('message', receive)
    return () => window.removeEventListener('message', receive)
  }, [appendLog])

  const onWorkspaceChange = useCallback(
    (nextSnapshot: BlocklyWorkspaceSnapshot) => {
      const current = projectRef.current
      if (!current) return
      const next = makeVisualProject({
        ...current,
        workspace: nextSnapshot.workspace,
        updatedAt: new Date().toISOString(),
      }) as VisualProject
      recalculate(next, nextSnapshot)
      persistProject(next)
    },
    [persistProject, recalculate]
  )

  const onWorkspaceReady = useCallback((controller: BlocklyWorkspaceController | null) => {
    workspaceRef.current = controller
  }, [])

  const updateProject = useCallback(
    (changes: Partial<VisualProject>) => {
      const current = projectRef.current
      if (!current) return
      const next = makeVisualProject({
        ...current,
        ...changes,
        updatedAt: new Date().toISOString(),
      }) as VisualProject
      persistProject(next)
      const currentSnapshot = workspaceRef.current?.snapshot() ?? snapshot
      if (currentSnapshot) recalculate(next, currentSnapshot)
      return next
    },
    [persistProject, recalculate, snapshot]
  )

  const loadProject = useCallback(
    (next: VisualProject) => {
      projectRef.current = next
      persistProject(next)
      workspaceRef.current?.load(next.workspace)
    },
    [persistProject]
  )

  const newProject = useCallback(() => {
    const next = makeVisualProject({ workspace: sampleById('hello').workspace })
    loadProject(next)
  }, [loadProject])

  const duplicateProject = useCallback(() => {
    const current = projectRef.current
    if (current) loadProject(duplicateVisualProject(current) as VisualProject)
  }, [loadProject])

  const importProject = useCallback(
    async (file: File) => {
      try {
        if (file.size > MAX_PROJECT_JSON_BYTES) {
          throw new Error(`プロジェクトは${formatByteSize(MAX_PROJECT_JSON_BYTES)}以下にしてください`)
        }
        loadProject(parseVisualProject(await file.text()) as VisualProject)
      } catch (error) {
        appendLog(String(error instanceof Error ? error.message : error), 'error', 'system')
      }
    },
    [appendLog, loadProject]
  )

  const exportProject = useCallback(() => {
    const current = projectRef.current
    if (!current) return
    downloadBlob(new Blob([serializeVisualProject(current)], { type: 'application/json' }), projectFileName(current))
  }, [])

  const addAssets = useCallback(
    async (files: File[]) => {
      const current = projectRef.current
      if (!current) return
      if (current.assets.length + files.length > MAX_ASSET_COUNT) {
        appendLog(`アセットは${MAX_ASSET_COUNT}個まで追加できます`, 'error', 'system')
        return
      }
      const additions: ProjectAsset[] = []
      for (const file of files) {
        if (file.size > MAX_ASSET_BYTES) {
          appendLog(`${file.name}は${formatByteSize(MAX_ASSET_BYTES)}以下にしてください`, 'error', 'system')
          continue
        }
        const bytes = new Uint8Array(await file.arrayBuffer())
        let mediaType = file.type || 'application/octet-stream'
        let encoding: ProjectAsset['encoding'] = 'base64'
        let data = ''
        if (mediaType === FACE_ASSET_MEDIA_TYPE || file.name.toLowerCase().endsWith('.stackchan-face.json')) {
          const face = parseFaceAsset(new TextDecoder().decode(bytes))
          mediaType = FACE_ASSET_MEDIA_TYPE
          encoding = 'utf8'
          data = `${JSON.stringify(face, null, 2)}\n`
        } else {
          let binary = ''
          for (let offset = 0; offset < bytes.length; offset += 0x8000) {
            binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
          }
          data = btoa(binary)
        }
        additions.push({
          path: `assets/${file.name.replace(/[^\p{L}\p{N}._-]/gu, '_')}`,
          mediaType,
          encoding,
          data,
        })
      }
      const assets = [...current.assets]
      for (const addition of additions) {
        const index = assets.findIndex((asset) => asset.path === addition.path)
        if (index >= 0) assets[index] = addition
        else assets.push(addition)
      }
      const firstFace = additions.find((asset) => asset.mediaType === FACE_ASSET_MEDIA_TYPE)
      updateProject({
        assets,
        settings: {
          ...current.settings,
          faceAsset: firstFace?.path ?? current.settings.faceAsset,
        },
      } as Partial<VisualProject>)
    },
    [appendLog, updateProject]
  )

  const build = useCallback(async () => {
    const current = projectRef.current
    if (!current || !source) return
    if (!analysis.canBuild) {
      setBuildOperation({
        status: 'error',
        error: toAppError('ビルド前診断のエラーを修正してください', 'mod.validation'),
      })
      return
    }
    setBuildOperation({ status: 'pending', message: 'MODをビルドしています' })
    setArchive(null)
    try {
      const result = await buildVisualProjectMod({
        project: current,
        source,
        onLog: (message) => appendLog(message, 'info', 'build'),
      })
      const compatibility = inspectCompatibility(current.target, {
        xsVersion: result.xsVersion,
      })
      if (!compatibility.compatible) {
        throw new Error(compatibility.diagnostics.map((item: { message: string }) => item.message).join('\n'))
      }
      setArchive(result.archive)
      setBuildOperation({
        status: 'success',
        result,
        message: `ビルド成功: ${formatByteSize(result.archive.length)} / XS ${result.xsVersion?.join('.')} (${(
          result.elapsedMs / 1000
        ).toFixed(1)}秒)`,
      })
    } catch (error) {
      appendLog(String(error instanceof Error ? error.message : error), 'error', 'build')
      setBuildOperation({ status: 'error', error: toAppError(error, 'mod.build') })
    }
  }, [analysis.canBuild, appendLog, source])

  const downloadArchive = useCallback(() => {
    const current = projectRef.current
    if (!archive || !current) return
    downloadBlob(new Blob([archive as BlobPart]), `${current.name}.xsa`)
  }, [archive])

  const runInSimulator = useCallback(async () => {
    const current = projectRef.current
    if (!archive || !current) return
    try {
      await createModStorage().saveInstalledMod({ name: `${current.name}.xsa`, bytes: archive })
      setSimulatorSrc(`../simulator/?editor=${Date.now()}`)
      setSimulatorOpen(true)
    } catch (error) {
      appendLog(String(error instanceof Error ? error.message : error), 'error', 'simulator')
    }
  }, [appendLog, archive])

  const closeSimulator = useCallback(() => {
    setSimulatorOpen(false)
    setSimulatorSrc('about:blank')
  }, [])

  const postSimulatorCommand = useCallback((command: string, detail = {}) => {
    simulatorFrameRef.current?.contentWindow?.postMessage(
      { type: 'stackchan-editor-command', command, ...detail },
      location.origin
    )
  }, [])

  const askForConfirmation = useCallback(
    (next: Omit<Confirmation, 'resolve'>) =>
      new Promise<boolean>((resolve) => {
        const value = { ...next, resolve }
        confirmationRef.current = value
        setConfirmation(value)
      }),
    []
  )

  const resolveConfirmation = useCallback((approved: boolean) => {
    const pending = confirmationRef.current
    confirmationRef.current = null
    setConfirmation(null)
    pending?.resolve(approved)
  }, [])

  const installToDevice = useCallback(async () => {
    const current = projectRef.current
    const serial = (navigator as SerialNavigator).serial
    if (!archive || !current) return
    if (!serial || !profileFor(current.target).deviceInstall) {
      setDeviceOperation({
        status: 'error',
        error: toAppError(
          'この対象機種またはブラウザーではWebSerial実機書き込みを利用できません',
          'device.unsupported'
        ),
      })
      return
    }
    setDeviceOperation({ status: 'pending', message: 'USBデバイスを選択しています', progress: 0 })
    try {
      const port = await serial.requestPort()
      const result = await installDeviceArchive(createEsptoolLoader, port, archive, {
        onLog: (message: string) => appendLog(message, 'info', 'device'),
        onProgress: (progress: number) =>
          setDeviceOperation({ status: 'pending', message: '実機へMODを書き込んでいます', progress }),
        onPrompt: (message: string) => setDeviceOperation({ status: 'pending', message }),
        onPreflight: async ({
          chip,
          firmware,
        }: {
          chip: string
          firmware: { version: string; projectName: string }
        }) => {
          const compatibility = inspectCompatibility(current.target, {
            chip,
            xsVersion: buildOperation.status === 'success' ? buildOperation.result.xsVersion : undefined,
            firmwareVersion: firmware.version,
            requireFirmware: true,
            requireArchive: true,
          })
          if (!compatibility.compatible) {
            throw new Error(compatibility.diagnostics.map((item: { message: string }) => item.message).join('\n'))
          }
          return askForConfirmation({
            title: '実機へMODを書き込みますか？',
            description: `${chip} / ${firmware.projectName} ${firmware.version} のxsパーティションを更新します。`,
            confirmLabel: '書き込む',
          })
        },
      })
      if (result.status === DEVICE_OPERATION_STATUS.CANCELLED) {
        setDeviceOperation({ status: 'cancelled', message: '実機への書き込みをキャンセルしました' })
      } else {
        setDeviceOperation({
          status: 'success',
          result,
          message: `実機への書き込みと検証が終了しました (${String(result.chip ?? 'device')})`,
        })
      }
    } catch (error) {
      appendLog(String(error instanceof Error ? error.message : error), 'error', 'device')
      setDeviceOperation({ status: 'error', error: toAppError(error, 'device.install') })
    }
  }, [appendLog, archive, askForConfirmation, buildOperation])

  const removeFromDevice = useCallback(async () => {
    const current = projectRef.current
    const serial = (navigator as SerialNavigator).serial
    if (!current || !serial || !profileFor(current.target).deviceInstall) {
      setDeviceOperation({
        status: 'error',
        error: toAppError('この対象機種では実機のMODを削除できません', 'device.unsupported'),
      })
      return
    }
    setDeviceOperation({ status: 'pending', message: 'USBデバイスを選択しています' })
    try {
      const port = await serial.requestPort()
      const result = await removeDeviceArchive(createEsptoolLoader, port, {
        onLog: (message: string) => appendLog(message, 'info', 'device'),
        onPrompt: (message: string) => setDeviceOperation({ status: 'pending', message }),
        onPreflight: async ({
          chip,
          partition,
          firmware,
        }: {
          chip: string
          partition: { offset: number }
          firmware: { version: string }
        }) => {
          const compatibility = inspectCompatibility(current.target, {
            chip,
            firmwareVersion: firmware.version,
            requireFirmware: true,
          })
          if (!compatibility.compatible) {
            throw new Error(compatibility.diagnostics.map((item: { message: string }) => item.message).join('\n'))
          }
          return askForConfirmation({
            title: '実機のMODを削除しますか？',
            description: `${chip} / ${firmware.version} のxsパーティション（0x${partition.offset.toString(
              16
            )}）を消去します。`,
            confirmLabel: '削除する',
          })
        },
      })
      if (result.status === DEVICE_OPERATION_STATUS.CANCELLED) {
        setDeviceOperation({ status: 'cancelled', message: '実機のMOD削除をキャンセルしました' })
      } else {
        setDeviceOperation({ status: 'success', result, message: '実機のMODを削除しました' })
      }
    } catch (error) {
      appendLog(String(error instanceof Error ? error.message : error), 'error', 'device')
      setDeviceOperation({ status: 'error', error: toAppError(error, 'device.remove') })
    }
  }, [appendLog, askForConfirmation])

  const faceAssets = useMemo(
    () => project?.assets.filter((asset) => asset.mediaType === FACE_ASSET_MEDIA_TYPE) ?? [],
    [project]
  )

  return {
    locale,
    t,
    project,
    projects,
    snapshot,
    source,
    analysis,
    buildOperation,
    deviceOperation,
    archive,
    logs,
    clearLogs,
    confirmation,
    simulatorOpen,
    simulatorSrc,
    simulatorFrameRef,
    samples: VISUAL_SAMPLES,
    faceAssets,
    onWorkspaceChange,
    onWorkspaceReady,
    setName: (name: string) => updateProject({ name } as Partial<VisualProject>),
    setTarget: (target: string) => {
      updateProject({ target } as Partial<VisualProject>)
      workspaceRef.current?.setTarget(target)
    },
    setEmbedAssets: (embedAssets: boolean) => {
      const current = projectRef.current
      if (current) {
        updateProject({
          settings: { ...current.settings, embedAssets },
        } as Partial<VisualProject>)
      }
    },
    selectFace: (faceAsset: string | null) => {
      const current = projectRef.current
      if (current) {
        updateProject({
          settings: { ...current.settings, faceAsset },
        } as Partial<VisualProject>)
      }
    },
    removeAsset: (path: string) => {
      const current = projectRef.current
      if (!current) return
      updateProject({
        assets: current.assets.filter((asset) => asset.path !== path),
        settings: {
          ...current.settings,
          faceAsset: current.settings.faceAsset === path ? null : current.settings.faceAsset,
        },
      } as Partial<VisualProject>)
    },
    editSelectedFace: () => {
      const current = projectRef.current
      const asset = current?.assets.find((candidate) => candidate.path === current.settings.faceAsset)
      if (!current || !asset || asset.mediaType !== FACE_ASSET_MEDIA_TYPE) return
      saveFaceEditContext(parseFaceAsset(new TextDecoder().decode(assetBytes(asset))), {
        projectId: current.id,
        assetPath: asset.path,
      })
      location.href = '../face-editor/?face-edit=project'
    },
    newProject,
    duplicateProject,
    loadProject,
    importProject,
    exportProject,
    addAssets,
    loadSample: (sampleId: string) => {
      const sample = sampleById(sampleId)
      if (!sample) return
      workspaceRef.current?.load(sample.workspace)
    },
    clearWorkspace: () => workspaceRef.current?.clear(),
    focusDiagnostic: (blockId?: string | null) => {
      if (blockId) workspaceRef.current?.focusBlock(blockId)
    },
    build,
    downloadArchive,
    runInSimulator,
    stopSimulator: () => setSimulatorSrc('about:blank'),
    closeSimulator,
    postSimulatorCommand,
    installToDevice,
    removeFromDevice,
    resolveConfirmation,
  }
}
