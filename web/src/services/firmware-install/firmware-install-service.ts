import { type FirmwareBoard } from '@/features/firmware-install/boards'
import { AppError } from '@/lib/errors/app-error'
import { createEsptoolAdapter, type EsptoolAdapter } from '@/services/esptool/esptool-adapter'

type ManifestPart = { path: string; offset: number }
type ManifestBuild = { chipFamily: string; parts: ManifestPart[] }
type FirmwareManifest = { name: string; version: string; builds: ManifestBuild[] }

export type FirmwareDeviceInfo = {
  board: FirmwareBoard
  chip: string
  chipFamily: string
  firmwareName: string
  firmwareVersion: string
  partCount: number
}

export type FirmwareInstallResult = FirmwareDeviceInfo & {
  bytesWritten: number
}

export type FirmwareInstallCallbacks = {
  onLog: (message: string) => void
  onStage: (stage: 'inspecting' | 'installing') => void
  onProgress: (progress: number) => void
  onConfirm: (device: FirmwareDeviceInfo) => Promise<boolean>
}

type SerialPortLike = Parameters<typeof createEsptoolAdapter>[0]

const canonicalChipFamily = (chip: string) => {
  const normalized = chip.toUpperCase()
  for (const family of ['ESP32-S3', 'ESP32-S2', 'ESP32-C6', 'ESP32-C3', 'ESP32-H2', 'ESP32-P4']) {
    if (normalized.includes(family)) return family
  }
  return normalized.includes('ESP32') ? 'ESP32' : normalized
}

const validateManifest = (value: unknown): FirmwareManifest => {
  if (!value || typeof value !== 'object') throw new AppError('manifest-invalid', 'manifestの形式が不正です')
  const manifest = value as Partial<FirmwareManifest>
  if (
    typeof manifest.name !== 'string' ||
    typeof manifest.version !== 'string' ||
    !Array.isArray(manifest.builds) ||
    manifest.builds.length === 0
  ) {
    throw new AppError('manifest-invalid', 'manifestに必要なファームウェア情報がありません')
  }
  for (const build of manifest.builds) {
    if (
      typeof build?.chipFamily !== 'string' ||
      !Array.isArray(build.parts) ||
      build.parts.some((part) => typeof part?.path !== 'string' || !Number.isSafeInteger(part.offset))
    ) {
      throw new AppError('manifest-invalid', 'manifestの書き込み対象が不正です')
    }
  }
  return manifest as FirmwareManifest
}

const loadManifest = async (url: string) => {
  const response = await fetch(url)
  if (!response.ok) {
    throw new AppError('manifest-fetch', `manifestを取得できませんでした (HTTP ${response.status})`)
  }
  return validateManifest(await response.json())
}

const loadPart = async (part: ManifestPart, manifestUrl: string) => {
  const url = new URL(part.path, manifestUrl)
  const response = await fetch(url)
  if (!response.ok) {
    throw new AppError('firmware-fetch', `${part.path}を取得できませんでした (HTTP ${response.status})`)
  }
  return { address: part.offset, bytes: new Uint8Array(await response.arrayBuffer()) }
}

export async function installFirmware(
  port: SerialPortLike,
  board: FirmwareBoard,
  callbacks: FirmwareInstallCallbacks,
  adapterFactory = createEsptoolAdapter
): Promise<FirmwareInstallResult | null> {
  const { onConfirm, onLog, onProgress, onStage } = callbacks
  let adapter: EsptoolAdapter | undefined
  try {
    onStage('inspecting')
    onLog('ブートローダへ接続しています…')
    adapter = await adapterFactory(port, onLog)
    const chip = await adapter.inspect()
    const chipFamily = canonicalChipFamily(chip)
    onLog(`検出したデバイス: ${chip}`)

    const manifest = await loadManifest(board.manifestUrl)
    const build = manifest.builds.find((candidate) => candidate.chipFamily.toUpperCase() === chipFamily)
    if (!build) {
      throw new AppError(
        'chip-mismatch',
        `${board.label}用ファームウェアは${chipFamily}へ書き込めません。ボード選択を確認してください。`
      )
    }

    const device: FirmwareDeviceInfo = {
      board,
      chip,
      chipFamily,
      firmwareName: manifest.name,
      firmwareVersion: manifest.version,
      partCount: build.parts.length,
    }
    if (!(await onConfirm(device))) {
      onLog('利用者がファームウェア書き込みをキャンセルしました')
      try {
        await adapter.resetToRunApp()
      } catch {
        // The board may already have left the bootloader.
      }
      return null
    }

    onStage('installing')
    onLog('ファームウェアイメージを取得しています…')
    const files = await Promise.all(build.parts.map((part) => loadPart(part, board.manifestUrl)))
    const fileSizes = files.map((file) => file.bytes.length)
    const totalBytes = fileSizes.reduce((total, size) => total + size, 0)
    const completedBefore = fileSizes.map((_, index) =>
      fileSizes.slice(0, index).reduce((total, size) => total + size, 0)
    )
    onLog(`${files.length}個の領域、合計${totalBytes.toLocaleString()}バイトを書き込みます`)

    await adapter.write(files, (fileIndex, written, fileTotal) => {
      const base = completedBefore[fileIndex] ?? 0
      const boundedWritten = Math.min(written, fileTotal)
      onProgress(totalBytes > 0 ? Math.min(1, (base + boundedWritten) / totalBytes) : 0)
    })
    onProgress(1)
    onLog('書き込みが終了しました。デバイスを再起動します')
    await adapter.resetToRunApp()
    return { ...device, bytesWritten: totalBytes }
  } finally {
    try {
      await adapter?.disconnect()
    } catch {
      // The reset can close the serial port before the explicit disconnect.
    }
  }
}

export const firmwareInstallInternals = {
  canonicalChipFamily,
  validateManifest,
}
