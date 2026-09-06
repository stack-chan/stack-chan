import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { ToolError } from '@/services/webmcp/runtime'
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
import { type SimulatorReady } from '@/services/simulator/simulator-engine.mjs'
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
import { fetchExternalProject, projectUrlFromSearch } from '../../../editor/external-project.mjs'
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
import { formatByteSize } from '../../../simulator/mod-storage.mjs'

const PROJECT_STORAGE_KEY = 'stackchan-visual-project-v1'

const makeVisualProject = createVisualProject as unknown as (
  options: Partial<VisualProject> & { workspace: Record<string, unknown> }
) => VisualProject

type Confirmation = {
  title: string
  description: string
  confirmLabel: string
  resolve: (approved: boolean) => void
}

type RecoveryRecord = {
  version: 1
  capturedAt: string
  error: string
  raw: string
}

export type DeviceOperationOptions = {
  signal?: AbortSignal
  guard?: () => void
  protect?: () => void
  waitForUser?: <T>(promise: Promise<T>) => Promise<T>
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

function projectFieldChanged(current: unknown, next: unknown) {
  if (Object.is(current, next)) return false
  if (typeof current !== 'object' || current === null || typeof next !== 'object' || next === null) return true
  return JSON.stringify(current) !== JSON.stringify(next)
}

export function useProjectEditor() {
  const { locale, t } = useI18n()
  const storageRef = useRef(createProjectStorage())
  const saveQueueRef = useRef(Promise.resolve())
  const projectRef = useRef<VisualProject | null>(null)
  const projectsRef = useRef<VisualProject[]>([])
  const workspaceRef = useRef<BlocklyWorkspaceController | null>(null)
  const confirmationRef = useRef<Confirmation | null>(null)
  const buildGenerationRef = useRef(0)
  const saveErrorRef = useRef<unknown>(null)
  const archiveRef = useRef<ModBuildResult | null>(null)
  const deviceBusyRef = useRef(false)
  const simulatorControllerRef = useRef<{ pushButton: (name: 'a' | 'b' | 'c') => void } | null>(null)
  const simulatorResultRef = useRef<{ status: string; error?: string }>({ status: 'stopped' })
  const simulatorWaiterRef = useRef<{ resolve: (value: unknown) => void; reject: (error: unknown) => void } | null>(
    null
  )
  const [project, setProject] = useState<VisualProject | null>(null)
  const [projects, setProjects] = useState<VisualProject[]>([])
  const snapshotRef = useRef<BlocklyWorkspaceSnapshot | null>(null)
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
  const [recovery, setRecovery] = useState<RecoveryRecord | null>(null)
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)
  const [simulatorOpen, setSimulatorOpen] = useState(false)
  const { entries: logs, append: appendLog, clear: clearLogs } = useLogBuffer()

  const invalidateBuild = useCallback(() => {
    buildGenerationRef.current += 1
    archiveRef.current = null
    simulatorResultRef.current = { status: 'stopped' }
    simulatorWaiterRef.current?.reject(new ToolError('revision_conflict', 'プロジェクトが変更されました。'))
    simulatorWaiterRef.current = null
    simulatorControllerRef.current = null
    setSimulatorOpen(false)
    setArchive(null)
    setBuildOperation({ status: 'idle' })
  }, [])

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
        .then(async () => {
          await storageRef.current.saveState(state)
          saveErrorRef.current = null
        })
        .catch((error) => {
          saveErrorRef.current = error
          appendLog(`プロジェクトを自動保存できませんでした: ${String(error)}`, 'error', 'system')
        })
    },
    [appendLog]
  )

  const recalculate = useCallback(
    (
      nextProject: VisualProject,
      nextSnapshot: BlocklyWorkspaceSnapshot,
      { invalidateBuild: shouldInvalidateBuild = true }: { invalidateBuild?: boolean } = {}
    ) => {
      snapshotRef.current = nextSnapshot
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
      if (shouldInvalidateBuild) invalidateBuild()
    },
    [invalidateBuild]
  )

  useEffect(() => {
    let active = true
    const load = async () => {
      let current: VisualProject | null = null
      let library: VisualProject[] = []
      let recoveryRecord: RecoveryRecord | null = null
      try {
        const stored = await storageRef.current.loadState()
        current = (stored?.currentProject as VisualProject | undefined) ?? null
        library = (stored?.projects as VisualProject[] | undefined) ?? []
      } catch (error) {
        appendLog(`保存したプロジェクトを復元できませんでした: ${String(error)}`, 'error', 'system')
      }
      try {
        recoveryRecord = (await storageRef.current.loadRecovery()) as RecoveryRecord | null
      } catch (error) {
        appendLog(`復旧データを読み込めませんでした: ${String(error)}`, 'error', 'system')
      }
      // A cancelled StrictMode load must not consume staged transfers or change the URL.
      if (!active) return
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
        const linkedProjectUrl = projectUrlFromSearch(location.search, location.href)
        if (linkedProjectUrl) {
          current = (await fetchExternalProject(linkedProjectUrl)) as VisualProject
          if (!active) return
          history.replaceState(null, '', location.pathname)
          appendLog(`Galleryから「${current.name}」を読み込みました`, 'info', 'system')
        }
      } catch (error) {
        appendLog(`Galleryのプロジェクトを読み込めませんでした: ${String(error)}`, 'error', 'system')
      }

      try {
        if (new URLSearchParams(location.search).get('face-asset') === 'staging') {
          const transfer = loadStagedFaceTransfer()
          if (!transfer) throw new Error('顔エディタからの受け渡しデータがありません')
          if (transfer.edit && transfer.edit.projectId !== current.id) {
            throw new Error('編集元と現在のMODプロジェクトが一致しません')
          }
          current = addFaceAssetToProject(
            current,
            transfer.asset,
            transfer.edit ? { replacePath: transfer.edit.assetPath } : undefined
          )
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
      setRecovery(recoveryRecord)
    }
    void load()
    return () => {
      active = false
    }
  }, [appendLog])

  useEffect(
    () => () => {
      buildGenerationRef.current += 1
      confirmationRef.current?.resolve(false)
      simulatorWaiterRef.current?.reject(new ToolError('cancelled', '操作をキャンセルしました。'))
      simulatorWaiterRef.current = null
    },
    []
  )

  const onSimulatorTrace = useCallback(
    (message: string) => appendLog(message, message.startsWith('[err]') ? 'error' : 'trace', 'simulator'),
    [appendLog]
  )

  const onSimulatorReady = useCallback(({ runCount }: SimulatorReady) => {
    simulatorResultRef.current = { status: 'running' }
    simulatorWaiterRef.current?.resolve({ status: 'running', runCount })
    simulatorWaiterRef.current = null
    setBuildOperation((current) =>
      current.status === 'success'
        ? {
            ...current,
            message:
              runCount > 1
                ? `シミュレーターでMODを再実行しました（${runCount}回目）`
                : 'シミュレーターでMODを実行しています',
          }
        : current
    )
  }, [])

  const onSimulatorError = useCallback(
    (error: unknown) => {
      simulatorResultRef.current = { status: 'error', error: String(error instanceof Error ? error.message : error) }
      simulatorWaiterRef.current?.reject(error)
      simulatorWaiterRef.current = null
      appendLog(String(error instanceof Error ? error.message : error), 'error', 'simulator')
    },
    [appendLog]
  )

  const onWorkspaceChange = useCallback(
    (nextSnapshot: BlocklyWorkspaceSnapshot) => {
      const current = projectRef.current
      if (!current) return
      const changed =
        projectFieldChanged(current.workspace, nextSnapshot.workspace) ||
        snapshotRef.current?.source !== nextSnapshot.source
      const next = changed
        ? (makeVisualProject({
            ...current,
            workspace: nextSnapshot.workspace,
            updatedAt: new Date().toISOString(),
          }) as VisualProject)
        : current
      recalculate(next, nextSnapshot, { invalidateBuild: changed })
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
      const changedEntries = (
        Object.entries(changes) as Array<[keyof VisualProject, VisualProject[keyof VisualProject]]>
      ).filter(([key, value]) => projectFieldChanged(current[key], value))
      if (changedEntries.length === 0) return current
      const appliedChanges = Object.fromEntries(changedEntries) as Partial<VisualProject>
      const next = makeVisualProject({
        ...current,
        ...appliedChanges,
        updatedAt: new Date().toISOString(),
      }) as VisualProject
      persistProject(next)
      const shouldInvalidateBuild = changedEntries.some(
        ([key]) => key === 'name' || key === 'target' || key === 'assets' || key === 'settings'
      )
      if (shouldInvalidateBuild) {
        const currentSnapshot = workspaceRef.current?.snapshot() ?? snapshot
        if (currentSnapshot) recalculate(next, currentSnapshot, { invalidateBuild: true })
        else invalidateBuild()
      }
      return next
    },
    [invalidateBuild, persistProject, recalculate, snapshot]
  )

  const loadProject = useCallback(
    (next: VisualProject) => {
      invalidateBuild()
      projectRef.current = next
      persistProject(next)
      workspaceRef.current?.load(next.workspace)
    },
    [invalidateBuild, persistProject]
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
      let raw = ''
      try {
        if (file.size > MAX_PROJECT_JSON_BYTES) {
          throw new Error(`プロジェクトは${formatByteSize(MAX_PROJECT_JSON_BYTES)}以下にしてください`)
        }
        raw = await file.text()
        loadProject(parseVisualProject(raw) as VisualProject)
      } catch (error) {
        const recoveryRecord: RecoveryRecord = {
          version: 1,
          capturedAt: new Date().toISOString(),
          error: String(error instanceof Error ? error.message : error),
          raw,
        }
        setRecovery(recoveryRecord)
        void storageRef.current.saveRecovery(recoveryRecord).catch((storageError) => {
          appendLog(`復旧データを保存できませんでした: ${String(storageError)}`, 'error', 'system')
        })
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

  const exportRecovery = useCallback(() => {
    if (!recovery) return
    downloadBlob(
      new Blob([`${JSON.stringify(recovery, null, 2)}\n`], { type: 'application/json' }),
      `stackchan-project-recovery-${recovery.capturedAt.replace(/[:.]/g, '-')}.json`
    )
  }, [recovery])

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

  const build = useCallback(
    async (signal?: AbortSignal) => {
      const current = projectRef.current
      const liveSnapshot = workspaceRef.current?.snapshot() ?? snapshotRef.current
      if (!current || !liveSnapshot) return { ok: false as const, code: 'not_ready' }
      let currentSource: string
      try {
        currentSource = sourceForProject(current, liveSnapshot.source)
      } catch (error) {
        invalidateBuild()
        setBuildOperation({ status: 'error', error: toAppError(error, 'mod.validation') })
        return { ok: false as const, code: 'validation_failed' }
      }
      const currentAnalysis = analyzeWorkspace(liveSnapshot.workspace, { target: current.target })
      if (!currentAnalysis.canBuild || liveSnapshot.generationError) {
        setBuildOperation({
          status: 'error',
          error: toAppError('ビルド前診断のエラーを修正してください', 'mod.validation'),
        })
        return { ok: false as const, code: 'validation_failed' }
      }
      invalidateBuild()
      const buildGeneration = buildGenerationRef.current
      setBuildOperation({ status: 'pending', message: 'MODをビルドしています' })
      setArchive(null)
      archiveRef.current = null
      try {
        const result = await buildVisualProjectMod({
          project: current,
          source: currentSource,
          signal,
          onLog: (message) => {
            if (buildGeneration === buildGenerationRef.current) appendLog(message, 'info', 'build')
          },
        })
        if (buildGeneration !== buildGenerationRef.current) return { ok: false as const, code: 'revision_conflict' }
        const latestSnapshot = workspaceRef.current?.snapshot()
        if (latestSnapshot && JSON.stringify(latestSnapshot) !== JSON.stringify(liveSnapshot)) {
          invalidateBuild()
          return { ok: false as const, code: 'revision_conflict' }
        }
        const compatibility = inspectDeploymentCompatibility(current.target, {
          xsVersion: result.xsVersion,
        })
        if (!compatibility.compatible) {
          throw new Error(compatibility.diagnostics.map((item) => item.message).join('\n'))
        }
        archiveRef.current = result
        setArchive(result.archive)
        setBuildOperation({
          status: 'success',
          result,
          message: `ビルド成功: ${formatByteSize(result.archive.length)} / XS ${result.xsVersion?.join('.')} (${(
            result.elapsedMs / 1000
          ).toFixed(1)}秒)`,
        })
        return {
          ok: true as const,
          bytes: result.archive.length,
          xsVersion: result.xsVersion,
          elapsedMs: result.elapsedMs,
        }
      } catch (error) {
        if (buildGeneration !== buildGenerationRef.current) return { ok: false as const, code: 'revision_conflict' }
        appendLog(String(error instanceof Error ? error.message : error), 'error', 'build')
        setBuildOperation({ status: 'error', error: toAppError(error, 'mod.build') })
        return { ok: false as const, code: signal?.aborted ? 'cancelled' : 'build_failed' }
      }
    },
    [appendLog, invalidateBuild]
  )

  const downloadArchive = useCallback(() => {
    const current = projectRef.current
    if (!archive || !current) return
    downloadBlob(new Blob([archive as BlobPart]), `${current.name}.xsa`)
  }, [archive])

  const runInSimulator = useCallback(() => {
    if (archiveRef.current && projectRef.current) {
      simulatorResultRef.current = { status: 'starting' }
      setSimulatorOpen(true)
    }
  }, [archive])

  const closeSimulator = useCallback(() => {
    setSimulatorOpen(false)
    simulatorControllerRef.current = null
    simulatorResultRef.current = { status: 'stopped' }
    simulatorWaiterRef.current?.reject(new ToolError('cancelled', 'シミュレーターを閉じました。'))
    simulatorWaiterRef.current = null
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

  const runDeviceOperation = useCallback(
    async (action: 'install' | 'remove', options: DeviceOperationOptions = {}) => {
      const current = projectRef.current
      const built = archiveRef.current
      const serial = (navigator as SerialNavigator).serial
      if (deviceBusyRef.current) return { ok: false as const, code: 'busy' }
      if (!current || !serial || !profileFor(current.target).deviceInstall || (action === 'install' && !built)) {
        setDeviceOperation({
          status: 'error',
          error: toAppError(
            'この対象機種またはブラウザーではWebSerial実機書き込みを利用できません',
            'device.unsupported'
          ),
        })
        return { ok: false as const, code: 'not_ready' }
      }
      const generation = buildGenerationRef.current
      const ensureCurrent = () => {
        options.signal?.throwIfAborted()
        options.guard?.()
        if (generation !== buildGenerationRef.current || current.id !== projectRef.current?.id)
          throw new ToolError('revision_conflict', 'プロジェクトが更新されています。操作をやり直してください。')
      }
      const abortConfirmation = () => resolveConfirmation(false)
      deviceBusyRef.current = true
      setDeviceOperation({ status: 'pending', message: 'USBデバイスを選択しています', progress: 0 })
      options.signal?.addEventListener('abort', abortConfirmation, { once: true })
      try {
        ensureCurrent()
        const port = await serial.requestPort()
        ensureCurrent()
        const callbacks = {
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
            ensureCurrent()
            const compatibility = inspectDeploymentCompatibility(current.target, {
              chip,
              firmwareVersion: firmware.version,
              requireFirmware: true,
              ...(action === 'install' ? { xsVersion: built!.xsVersion, requireArchive: true } : {}),
            })
            if (!compatibility.compatible)
              throw new ToolError(
                'incompatible_device',
                compatibility.diagnostics.map((item) => item.message).join('\n')
              )
            const confirmation = askForConfirmation({
              title: action === 'install' ? '実機へMODを書き込みますか？' : '実機のMODを削除しますか？',
              description:
                chip +
                ' / ' +
                firmware.version +
                (action === 'install'
                  ? ' のxsパーティションを更新します。'
                  : ' のxsパーティションにあるMODを削除します。'),
              confirmLabel: action === 'install' ? '書き込む' : '削除する',
            })
            const approved = await (options.waitForUser ? options.waitForUser(confirmation) : confirmation)
            if (!approved) return false
            ensureCurrent()
            options.protect?.()
            return true
          },
        }
        const result =
          action === 'install'
            ? await installModToDevice(createEsptoolLoader, port, built!.archive, callbacks)
            : await removeModFromDevice(createEsptoolLoader, port, callbacks)
        if (result.status === DEVICE_OPERATION_STATUS.CANCELLED) {
          setDeviceOperation({ status: 'cancelled', message: '実機の操作をキャンセルしました。' })
          return { ok: false as const, code: 'cancelled' }
        }
        setDeviceOperation({
          status: 'success',
          result,
          message: action === 'install' ? '実機への書き込みと検証が終了しました。' : '実機のMODを削除しました',
        })
        return { ok: true as const, ...result }
      } catch (error) {
        const cancelled = options.signal?.aborted || (error instanceof DOMException && error.name === 'NotFoundError')
        if (cancelled) setDeviceOperation({ status: 'cancelled', message: '実機の操作をキャンセルしました。' })
        else {
          appendLog(String(error instanceof Error ? error.message : error), 'error', 'device')
          setDeviceOperation({ status: 'error', error: toAppError(error, 'device.' + action) })
        }
        return {
          ok: false as const,
          code: cancelled ? 'cancelled' : error instanceof ToolError ? error.code : 'device_failed',
        }
      } finally {
        deviceBusyRef.current = false
        options.signal?.removeEventListener('abort', abortConfirmation)
      }
    },
    [appendLog, askForConfirmation, resolveConfirmation]
  )

  const installToDevice = useCallback(
    (options?: DeviceOperationOptions) => runDeviceOperation('install', options),
    [runDeviceOperation]
  )
  const removeFromDevice = useCallback(
    (options?: DeviceOperationOptions) => runDeviceOperation('remove', options),
    [runDeviceOperation]
  )

  const faceAssets = useMemo(
    () => project?.assets.filter((asset) => asset.mediaType === FACE_ASSET_MEDIA_TYPE) ?? [],
    [project]
  )

  return {
    getCurrent: () => {
      const current = projectRef.current
      const live = workspaceRef.current?.snapshot()
      if (!current || !live) throw new ToolError('not_ready', 'エディタの準備が終わってから操作してください。')
      const generatedSource = sourceForProject(current, live.source)
      return {
        project: { ...current, workspace: live.workspace },
        source: generatedSource,
        analysis: {
          ...analyzeWorkspace(live.workspace, { target: current.target }),
          ...(live.generationError ? { canBuild: false, generationError: live.generationError } : {}),
        },
        archiveReady: Boolean(archiveRef.current),
        simulator: { ...simulatorResultRef.current },
        deviceBusy: deviceBusyRef.current,
      }
    },
    getWorkspace: () => {
      if (!workspaceRef.current) throw new ToolError('not_ready', 'エディタの準備が終わってから操作してください。')
      return workspaceRef.current
    },
    updateProject,
    flushSave: async () => {
      const live = workspaceRef.current?.snapshot()
      if (live) onWorkspaceChange(live)
      await saveQueueRef.current
      if (saveErrorRef.current) throw new ToolError('storage_failed', 'プロジェクトを保存できませんでした。')
    },
    setSimulatorController: (controller: { pushButton: (name: 'a' | 'b' | 'c') => void } | null) => {
      simulatorControllerRef.current = controller
    },
    pressSimulatorButton: (name: 'a' | 'b' | 'c') => {
      if (simulatorResultRef.current.status !== 'running' || !simulatorControllerRef.current)
        throw new ToolError('not_ready', 'シミュレーターを起動してください。')
      simulatorControllerRef.current.pushButton(name)
    },
    startSimulator: (signal: AbortSignal) => {
      if (!archiveRef.current) throw new ToolError('not_ready', '先に現在のプロジェクトをビルドしてください。')
      if (simulatorResultRef.current.status === 'running') return Promise.resolve({ status: 'running' })
      if (simulatorWaiterRef.current) throw new ToolError('busy', 'シミュレーターを起動中です。')
      return new Promise((resolve, reject) => {
        const abort = () => closeSimulator()
        const timeout = window.setTimeout(() => {
          simulatorWaiterRef.current?.reject(new ToolError('timeout', 'シミュレーターの起動がタイムアウトしました。'))
          simulatorWaiterRef.current = null
          closeSimulator()
        }, 60000)
        const finish = () => {
          signal.removeEventListener('abort', abort)
          window.clearTimeout(timeout)
        }
        simulatorWaiterRef.current = {
          resolve: (value) => {
            finish()
            resolve(value)
          },
          reject: (error) => {
            finish()
            reject(error)
          },
        }
        signal.addEventListener('abort', abort, { once: true })
        if (signal.aborted) abort()
        else runInSimulator()
      })
    },
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
    recovery,
    logs,
    clearLogs,
    confirmation,
    simulatorOpen,
    onSimulatorTrace,
    onSimulatorReady,
    onSimulatorError,
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
    exportRecovery,
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
    closeSimulator,
    installToDevice,
    removeFromDevice,
    resolveConfirmation,
  }
}
