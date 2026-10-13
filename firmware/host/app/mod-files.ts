import type { Directory } from 'embedded:storage/files'

// A MOD is a single ASCII basename, never a subpath supplied by the card.
function isModFilename(name: string): boolean {
  return name.length >= 5 && name.length <= 68 && name.endsWith('.xsa') && !/[^A-Za-z0-9_-]/.test(name.slice(0, -4))
}

export function listModFiles(files: Directory): string[] {
  const directory = files.openDirectory({ path: 'mods' })
  try {
    const names: string[] = []
    for (const name of directory.scan()) {
      if (isModFilename(name) && directory.status(name).isFile()) names.push(name)
    }
    return names
  } finally {
    directory.close()
  }
}

export function readModFile(files: Directory, name: string, maximumBytes: number): ArrayBuffer {
  if (!isModFilename(name) || !Number.isSafeInteger(maximumBytes) || maximumBytes <= 0) {
    throw new Error('invalid MOD filename or size')
  }
  const file = files.openFile({ path: `mods/${name}`, mode: 'r' })
  try {
    const status = file.status()
    if (!status.isFile() || status.size <= 0 || status.size > maximumBytes) {
      throw new Error('MOD file size is invalid')
    }
    const buffer = file.read(status.size, 0)
    if (buffer.byteLength !== status.size) throw new Error('MOD file read failed')
    return buffer
  } finally {
    file.close()
  }
}
