import { formatByteSize } from './mod-storage.mjs'

export const ALLOWED_MOD_BUILD_TARGETS = ['esp32/m5stack', 'esp32/m5stack_core2', 'esp32/m5stack_cores3']
export const ALLOWED_TRANSFER_TRANSPORTS = ['web-serial', 'ble-serial']

function assertWorkspacePath(path) {
  if (
    typeof path !== 'string' ||
    path.length === 0 ||
    path.startsWith('/') ||
    path.includes('..') ||
    path.includes('\\')
  ) {
    throw new Error(`path must be workspace-relative: ${path}`)
  }
}

function normalizeTransportList(requestedTransports = ['web-serial']) {
  const transports = [...new Set(requestedTransports)]
  for (const transport of transports) {
    if (!ALLOWED_TRANSFER_TRANSPORTS.includes(transport)) throw new Error(`unsupported transfer transport: ${transport}`)
  }
  return transports
}

export function createModBuildRequest({ target, entry, files, requestedTransports = ['web-serial'] }) {
  if (!ALLOWED_MOD_BUILD_TARGETS.includes(target)) throw new Error(`unsupported target: ${target}`)
  assertWorkspacePath(entry)
  if (!Array.isArray(files) || files.length === 0) throw new Error('at least one MOD source file is required')

  return {
    target,
    entry,
    files: files.map((file) => {
      assertWorkspacePath(file.path)
      return { path: file.path, content: file.content ?? '' }
    }),
    requestedTransports: normalizeTransportList(requestedTransports),
  }
}

export function summarizeBuildArtifact({ artifactName, target, size, sha256 }) {
  return `${artifactName} · ${target} · ${formatByteSize(size)} · ${sha256.slice(0, 8)}`
}
