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

// Standard ESP-IDF partition table location (CONFIG_PARTITION_TABLE_OFFSET).
export const PARTITION_TABLE_OFFSET = 0x8000
export const PARTITION_TABLE_SIZE = 0xc00 // 3 KB (max 95 entries + md5)
const PARTITION_MAGIC = 0x50aa // little-endian 0xAA 0x50
const PARTITION_TYPE_XS = 0x40 // Moddable mod/archive partition
const PARTITION_SUBTYPE_XS = 0x01
const PARTITION_TYPE_APP = 0x00
const PARTITION_SUBTYPE_FACTORY = 0x00
const ESP_APP_DESC_MAGIC = 0xabcd5432
export const ESP_APP_HEADER_SIZE = 256
export const DEVICE_OPERATION_STATUS = Object.freeze({
  CANCELLED: 'cancelled',
  INSTALLED: 'installed',
  REMOVED: 'removed',
})

/**
 * Parse an ESP-IDF partition table image and return every partition entry.
 * Each entry: { type, subtype, offset, size, label }.
 */
export function parsePartitionTable(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const entries = []
  for (let pos = 0; pos + 32 <= bytes.length; pos += 32) {
    const magic = view.getUint16(pos, true)
    if (magic !== PARTITION_MAGIC) break // 0xEBEB md5 row or padding -> end of table
    const type = view.getUint8(pos + 2)
    const subtype = view.getUint8(pos + 3)
    const offset = view.getUint32(pos + 4, true)
    const size = view.getUint32(pos + 8, true)
    let label = ''
    for (let i = 0; i < 16; i++) {
      const c = view.getUint8(pos + 12 + i)
      if (c === 0) break
      label += String.fromCharCode(c)
    }
    entries.push({ type, subtype, offset, size, label })
  }
  return entries
}

/**
 * Locate the Moddable `xs` MOD partition (type 0x40, subtype 1) in a parsed
 * partition table. Returns { offset, size } or throws.
 */
export function findXsPartition(entries) {
  const xs = entries.find((e) => e.type === PARTITION_TYPE_XS && e.subtype === PARTITION_SUBTYPE_XS)
  if (!xs) {
    const seen = entries.map((e) => `${e.label}(0x${e.type.toString(16)}/${e.subtype})`).join(', ')
    throw new Error(`MOD用の xs パーティションが見つかりません。検出: ${seen || 'なし'}`)
  }
  return xs
}

export function findAppPartition(entries) {
  const app =
    entries.find((entry) => entry.type === PARTITION_TYPE_APP && entry.subtype === PARTITION_SUBTYPE_FACTORY) ??
    entries.find((entry) => entry.type === PARTITION_TYPE_APP)
  if (!app) throw new Error('ファームウェアのappパーティションが見つかりません')
  return app
}

function readCString(bytes, offset, length) {
  let value = ''
  for (let index = 0; index < length && offset + index < bytes.length; index += 1) {
    const byte = bytes[offset + index]
    if (byte === 0) break
    value += String.fromCharCode(byte)
  }
  return value.trim()
}

export function parseEspAppDescriptor(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 0x70) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (view.getUint32(0x20, true) !== ESP_APP_DESC_MAGIC) return null
  const version = readCString(bytes, 0x30, 32)
  const hostVersion = /^(.*?)(?:\+stackchan|\.stackchan)\.([1-9][0-9]*)$/.exec(version)
  return {
    version,
    moddableVersion: hostVersion?.[1] ?? version,
    hostApiVersion: hostVersion ? Number(hostVersion[2]) : 0,
    projectName: readCString(bytes, 0x50, 32),
  }
}

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

export function xsArchiveByteLength(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 8) return null
  if (String.fromCharCode(...bytes.subarray(4, 8)) !== 'XS_A') return null
  const size = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, false)
  return size >= 8 ? size : null
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
