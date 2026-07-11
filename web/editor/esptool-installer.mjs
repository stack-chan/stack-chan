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
  { onLog = () => {}, onProgress = () => {}, onPrompt = () => {} } = {}
) {
  if (!(archive instanceof Uint8Array) || archive.length === 0) throw new Error('MODアーカイブが空です')

  const esploader = await loaderFactory({ port, onLog })

  try {
    onLog('[flash] ブートローダに接続しています…')
    const chip = await esploader.main()
    onLog(`[flash] 接続しました: ${chip}`)

    onLog('[flash] パーティションテーブルを読み込んでいます (0x8000)…')
    const tableBytes = await esploader.readFlash(PARTITION_TABLE_OFFSET, PARTITION_TABLE_SIZE)
    const partitions = parsePartitionTable(tableBytes)
    const xs = findXsPartition(partitions)
    onLog(`[flash] xs パーティション: offset=0x${xs.offset.toString(16)}, size=0x${xs.size.toString(16)}`)
    if (archive.length > xs.size) {
      throw new Error(`MODが大きすぎます (${archive.length} > パーティション ${xs.size} バイト)`)
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
  } finally {
    // release the WebSerial port so the device can run and can be reconnected
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
  // Use esptool-js's self-contained browser bundle: it inlines pako AND the
  // per-chip flasher stubs. The plain ESM entry (lib/index.js) fails on bare
  // deps ("pako"), and esm.sh fails to expose the stub JSON's keys as named
  // exports (breaks the stub's base64 atob). bundle.js avoids both.
  const { ESPLoader, Transport } = await import('https://unpkg.com/esptool-js@0.5.7/bundle.js')
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
