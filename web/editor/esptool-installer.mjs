import {
  PARTITION_TABLE_OFFSET,
  PARTITION_TABLE_SIZE,
  ESP_APP_HEADER_SIZE,
  parsePartitionTable,
  findXsPartition,
  findAppPartition,
  parseEspAppDescriptor,
  xsArchiveByteLength,
} from '../../firmware/contracts/esp-flash.js'
export {
  PARTITION_TABLE_OFFSET,
  PARTITION_TABLE_SIZE,
  ESP_APP_HEADER_SIZE,
  parsePartitionTable,
  findXsPartition,
  findAppPartition,
  parseEspAppDescriptor,
  xsArchiveByteLength,
} from '../../firmware/contracts/esp-flash.js'
/**
 * Install a MOD onto a real device by flashing the archive (.xsa) straight into
 * the `xs` flash partition with esptool-js — the same proven WebSerial path the
 * Flash page uses (esp-web-tools wraps esptool-js).
 *
 * Why this instead of the xsbug debug channel: writing the partition over the
 * ROM bootloader is reliable and board-agnostic, and needs no debug build, no
 * on-device trigger, and no fragile 2s debug-connection handshake. A MOD is
 * exactly the bytes of `mc.xsa` written to the `xs` partition (type 0x40,
 * subtype 1); the firmware maps and runs it on the next boot.
 *
 * The partition offset differs per board (flash size / layout), so we do NOT
 * hardcode it: the partition table lives at the fixed 0x8000 offset, so we read
 * it from the device and locate the `xs` partition dynamically.
 */

import { assertModCompatibility, hostForTarget } from '../../firmware/contracts/mod-package.js'
import { inspectModArchive } from '../../firmware/contracts/xsa-metadata.js'
import { isXsVersionCompatible, XS_ARCHIVE_VERSION_RANGE } from '../../firmware/contracts/xs-compatibility.js'

export const DEVICE_OPERATION_STATUS = Object.freeze({
  CANCELLED: 'cancelled',
  INSTALLED: 'installed',
  REMOVED: 'removed',
})

/**
 * Convert bytes to the Latin1 "binary string" esptool-js writeFlash expects
 * (one character per byte). Chunked so large archives don't blow the call stack.
 */
export function bytesToBinaryString(bytes) {
  let result = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    result += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize))
  }
  return result
}

export function equalBytes(left, right) {
  if (left.length !== right.length) return false
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false
  }
  return true
}

/**
 * Flash a MOD archive to the device's `xs` partition over WebSerial.
 *
 * @param loaderFactory  async ({ port, onLog }) => ESPLoader-like object exposing
 *                       main(), readFlash(addr,size,cb), writeFlash(opts),
 *                       after('hard_reset'). Injected so this module stays
 *                       testable without the esptool-js dependency.
 * @param port           an opened (or openable) WebSerial port
 * @param archive        Uint8Array of mc.xsa
 * @param options.onLog / options.onProgress
 */
export async function installModToDevice(
  loaderFactory,
  port,
  archive,
  { onLog = () => {}, onProgress = () => {}, onPrompt = () => {}, onPreflight = () => true, verify = true } = {}
) {
  if (!(archive instanceof Uint8Array) || archive.length === 0) throw new Error('MODアーカイブが空です')
  if (xsArchiveByteLength(archive) !== archive.length) throw new Error('XSアーカイブのヘッダーまたはサイズが不正です')
  const { metadata, version } = inspectModArchive(archive, (bytes) =>
    new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  )
  if (!isXsVersionCompatible(version, XS_ARCHIVE_VERSION_RANGE)) throw new Error('Incompatible XS archive version')

  const esploader = await loaderFactory({ port, onLog })

  try {
    onLog('[flash] ブートローダに接続しています…')
    const chip = await esploader.main()
    onLog(`[flash] 接続しました: ${chip}`)

    onLog('[flash] パーティションテーブルを読み込んでいます (0x8000)…')
    const tableBytes = await esploader.readFlash(PARTITION_TABLE_OFFSET, PARTITION_TABLE_SIZE)
    const partitions = parsePartitionTable(tableBytes)
    const xs = findXsPartition(partitions)
    const app = findAppPartition(partitions)
    onLog(`[flash] xs パーティション: offset=0x${xs.offset.toString(16)}, size=0x${xs.size.toString(16)}`)
    if (archive.length > xs.size) {
      throw new Error(`MODが大きすぎます (${archive.length} > パーティション ${xs.size} バイト)`)
    }

    onLog('[flash] ファームウェア情報を確認しています…')
    const appHeader = await esploader.readFlash(app.offset, ESP_APP_HEADER_SIZE)
    const firmware = parseEspAppDescriptor(appHeader)
    if (!firmware?.version) throw new Error('ファームウェアのバージョン情報を読み取れません')
    onLog(`[flash] ファームウェア: ${firmware.projectName || '名称不明'} ${firmware.version}`)
    assertModCompatibility(metadata, hostForTarget(firmware.target, firmware.hostApiVersion))
    if (!firmware.moddableVersion.startsWith('9.5.'))
      throw new Error('Update the firmware to Moddable 9.5 before installing this MOD')

    const approved = await onPreflight({
      chip,
      partition: xs,
      appPartition: app,
      firmware,
      archiveSize: archive.length,
    })
    if (!approved) {
      onLog('[flash] 利用者が実機書き込みをキャンセルしました')
      return {
        status: DEVICE_OPERATION_STATUS.CANCELLED,
        operation: 'install',
        chip,
        partition: xs,
        firmware,
      }
    }

    onLog('[flash] MODを書き込んでいます…')
    await esploader.writeFlash({
      fileArray: [{ data: bytesToBinaryString(archive), address: xs.offset }],
      flashSize: 'keep',
      flashMode: 'keep',
      flashFreq: 'keep',
      eraseAll: false,
      compress: true,
      reportProgress: (_fileIndex, written, total) => onProgress(total ? written / total : 0),
    })

    if (verify) {
      onLog('[flash] 書き込み内容を検証しています…')
      const written = await esploader.readFlash(xs.offset, archive.length)
      if (!equalBytes(written, archive)) throw new Error('書き込み後の検証に失敗しました')
      onLog('[flash] 書き込み内容を検証しました')
    }

    onLog('[flash] 書き込み完了。デバイスを再起動します')
    // Reboot into the MOD over CDC (no physical button). esptool-js's
    // after('hard_reset') pulses only RTS and leaves DTR wherever it was; on a
    // native USB-serial-JTAG part (CoreS3) DTR maps to IO0 (boot-mode select),
    // so a leftover DTR=asserted reboots the chip back into the download ROM
    // instead of the app. Drive IO0=HIGH (DTR=false) while pulsing EN (RTS),
    // both signals set atomically in one setSignals call, so it boots the app.
    try {
      await esploader.resetToRunApp()
    } catch (error) {
      onLog(`[flash] 自動リセットに失敗しました（本体のRESETボタンでも起動できます）: ${error.message ?? error}`)
      onPrompt('書き込み完了。自動で再起動しない場合は本体のRESETボタンを押すとMODが動きます')
    }
    return { status: DEVICE_OPERATION_STATUS.INSTALLED, chip, partition: xs, firmware, verified: verify }
  } finally {
    // release the WebSerial port so the device can run and can be reconnected
    try {
      await esploader.transport?.disconnect?.()
    } catch {
      // already disconnected
    }
  }
}

export async function removeModFromDevice(loaderFactory, port, options = {}) {
  const blankArchive = new Uint8Array(4096).fill(0xff)
  const onLog = options.onLog ?? (() => {})
  const esploader = await loaderFactory({ port, onLog })
  try {
    const chip = await esploader.main()
    const tableBytes = await esploader.readFlash(PARTITION_TABLE_OFFSET, PARTITION_TABLE_SIZE)
    const partitions = parsePartitionTable(tableBytes)
    const xs = findXsPartition(partitions)
    const app = findAppPartition(partitions)
    if (blankArchive.length > xs.size) {
      throw new Error(`xsパーティションが小さすぎます (${blankArchive.length} > ${xs.size} バイト)`)
    }
    const firmware = parseEspAppDescriptor(await esploader.readFlash(app.offset, ESP_APP_HEADER_SIZE))
    if (!firmware?.version) throw new Error('ファームウェアのバージョン情報を読み取れません')
    const approved = await (options.onPreflight ?? (() => true))({
      chip,
      partition: xs,
      appPartition: app,
      firmware,
      remove: true,
    })
    if (!approved) {
      onLog('[flash] 利用者がMOD削除をキャンセルしました')
      return {
        status: DEVICE_OPERATION_STATUS.CANCELLED,
        operation: 'remove',
        chip,
        partition: xs,
        firmware,
      }
    }

    await esploader.writeFlash({
      fileArray: [{ data: bytesToBinaryString(blankArchive), address: xs.offset }],
      flashSize: 'keep',
      flashMode: 'keep',
      flashFreq: 'keep',
      eraseAll: false,
      compress: true,
    })
    const written = await esploader.readFlash(xs.offset, blankArchive.length)
    if (!equalBytes(written, blankArchive)) throw new Error('MOD削除後の検証に失敗しました')
    try {
      await esploader.resetToRunApp?.()
    } catch (error) {
      onLog(`[flash] 自動リセットに失敗しました（本体のRESETボタンでも起動できます）: ${error.message ?? error}`)
      options.onPrompt?.('MOD削除完了。自動で再起動しない場合は本体のRESETボタンを押してください')
    }
    return { status: DEVICE_OPERATION_STATUS.REMOVED, chip, partition: xs, firmware, verified: true }
  } finally {
    try {
      await esploader.transport?.disconnect?.()
    } catch {
      // already disconnected
    }
  }
}

/**
 * Default esptool-js loader factory for the browser. Dynamically imports
 * esptool-js so Node unit tests of the pure helpers don't need it.
 */
export async function createEsptoolLoader({ port, onLog = () => {}, baudrate = 115200 } = {}) {
  // Use the vendored esptool-js 0.5.7 self-contained browser bundle: it inlines pako AND the
  // per-chip flasher stubs. The plain ESM entry (lib/index.js) fails on bare
  // deps ("pako"), and esm.sh fails to expose the stub JSON's keys as named
  // exports (breaks the stub's base64 atob). bundle.js avoids both.
  const { ESPLoader, Transport } = await import('./vendor/esptool-js-0.5.7.bundle.mjs')
  const transport = new Transport(port, true)
  const esploader = new ESPLoader({
    transport,
    baudrate,
    terminal: {
      clean() {},
      writeLine(line) {
        onLog(`[esptool] ${line}`)
      },
      write() {},
    },
  })

  return {
    transport,
    main: (...args) => esploader.main(...args),
    readFlash: (...args) => esploader.readFlash(...args),
    writeFlash: (...args) => esploader.writeFlash(...args),
    // Reboot into the app via CDC control signals. IO0=HIGH (DTR=false) selects
    // normal boot (not the download ROM); pulse EN (RTS) to reset. Set both in
    // one setSignals call so IO0 is never briefly low during the EN pulse.
    async resetToRunApp() {
      await port.setSignals({ dataTerminalReady: false, requestToSend: true })
      await new Promise((resolve) => setTimeout(resolve, 100))
      await port.setSignals({ dataTerminalReady: false, requestToSend: false })
    },
  }
}
