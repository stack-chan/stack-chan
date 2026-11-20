import type { Directory } from 'embedded:storage/files'
import { listModFiles, readModFile } from 'mod-files'
import openSDRoot from 'stackchan-sdroot'

let files: Directory | undefined

const begin = native('xs_stackchan_sdcard_begin')
const end = native('xs_stackchan_sdcard_end')
const nativeXsVersionRange = native('xs_stackchan_sdcard_xs_version_range')

// Keep Files lazy: absent/unreadable cards must not prevent firmware startup.
// Cache only successful mounts: a failed module import would cache the error.
export function withSDCard<T>(operation: (files: Directory) => T): T {
  begin.call(undefined)
  try {
    files ??= openSDRoot()
    return operation(files)
  } finally {
    end.call(undefined)
  }
}

export default Object.freeze({
  list(): string[] {
    return withSDCard(listModFiles)
  },
  read(name: string, maximumBytes: number): ArrayBuffer {
    return withSDCard((files) => readModFile(files, name, maximumBytes))
  },
  xsVersionRange(): readonly [number, number, number, number] {
    const bytes = new Uint8Array(nativeXsVersionRange.call(undefined) as ArrayBuffer)
    return [bytes[0], bytes[1], bytes[2], bytes[3]]
  },
})
