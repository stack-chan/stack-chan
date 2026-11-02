import { MAX_BYTECODE_BYTES } from './editor-model.mjs'
import { inspectDeploymentCompatibility } from '../editor/capabilities.mjs'
import { createEsptoolLoader, installModToDevice, xsArchiveByteLength } from '../editor/esptool-installer.mjs'
import { xsArchiveVersion } from '../editor/mod-builder.mjs'

export const MAX_TRANSFER_BYTECODE_BYTES = MAX_BYTECODE_BYTES
export const MAX_TRANSFER_ARCHIVE_BYTES = 256 * 1024

function bytecodeCopy(value) {
  const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : value
  if (!(bytes instanceof Uint8Array) || bytes.length < 16 || bytes.length > MAX_TRANSFER_BYTECODE_BYTES)
    throw new TypeError(`AVBC must contain 16..${MAX_TRANSFER_BYTECODE_BYTES} bytes`)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (view.getUint32(0, true) !== 0x53445641 || view.getUint16(4, true) !== 1)
    throw new TypeError('Expected AVDS v1 bytecode')
  return Uint8Array.from(bytes)
}

/** Package the repository's existing JS adapter; the native renderer stays in the host. */
export function createTransferProject({ bytecode, nativeFaceSource, contextSource, fallbackBytecode }) {
  const compiled = bytecodeCopy(bytecode)
  const fallback = bytecodeCopy(fallbackBytecode)
  if (typeof nativeFaceSource !== 'string' || typeof contextSource !== 'string')
    throw new TypeError('Shared native face adapter and context sources are required')
  const encode = (source) => new TextEncoder().encode(source)
  return {
    name: 'avatar-dsl-editor',
    modJs: `import Resource from 'Resource'
import { createAvatarFace } from 'avatar-dsl/face'
let face
export function onContextCreated(robot) {
  const next = createAvatarFace({ bytecode: new Resource('editor_face.avbc'), budget: { instructions: 12000, draws: 96 } })
  robot.ui.setFace(next.content)
  const previous = face
  face = next
  previous?.dispose()
}
`,
    manifest: {
      modules: { '*': ['./mod'], 'avatar-dsl/face': ['./native-face'], 'avatar-dsl/context': ['./context'] },
      resources: { '*': ['./assets/editor_face.avbc', './assets/default_face.avbc'] },
    },
    files: [
      { path: 'native-face.js', bytes: encode(nativeFaceSource) },
      { path: 'context.js', bytes: encode(contextSource) },
      { path: 'assets/editor_face.avbc', bytes: compiled },
      { path: 'assets/default_face.avbc', bytes: fallback },
    ],
  }
}

/** Transport layer only. UI and WebMCP callers use the staged controller below. */
export async function installTransferArchive({
  archive,
  port,
  loaderFactory = createEsptoolLoader,
  onLog,
  onProgress,
  isCurrent = () => true,
}) {
  return installModToDevice(loaderFactory, port, archive, {
    onLog,
    onProgress,
    verify: true,
    onPreflight({ chip, firmware }) {
      if (!isCurrent()) return false
      const compatibility = inspectDeploymentCompatibility('m5stackchan-cores3', {
        chip,
        xsVersion: xsArchiveVersion(archive),
        firmwareVersion: firmware.moddableVersion,
        requireArchive: true,
        requireFirmware: true,
      })
      if (!compatibility.compatible) throw new Error(compatibility.diagnostics.map((item) => item.message).join('\n'))
      return isCurrent()
    },
  })
}

/**
 * Agent-facing stage/cancel has no write side effects. Only a bound visible button
 * receiving a trusted browser click can select a port and start the installer.
 * nativeHostCheckbox acknowledges the PR725 host requirement, which the current
 * ESP descriptor cannot automatically identify. No boolean approval API exists.
 */
export function createTransferController({
  requestPort = () => navigator.serial.requestPort(),
  loaderFactory = createEsptoolLoader,
  onState = () => {},
  onLog = () => {},
} = {}) {
  let request = null
  let busy = false
  let sequence = 0
  let binding = null
  let nativeHostAcknowledged = false
  const notify = (status, extra = {}) => onState({ status, pending: controller.pending, busy, ...extra })
  const controller = {
    get pending() {
      return request
        ? Object.freeze({ id: request.id, sourceRevision: request.sourceRevision, archiveSize: request.archive.length })
        : null
    },
    get busy() {
      return busy
    },
    stage({ archive, sourceRevision }) {
      if (busy) throw new Error('A device operation is already in progress')
      if (
        !(archive instanceof Uint8Array) ||
        xsArchiveByteLength(archive) !== archive.length ||
        archive.length > MAX_TRANSFER_ARCHIVE_BYTES ||
        !xsArchiveVersion(archive)
      )
        throw new TypeError('Expected a bounded XS archive with a version header')
      request = { id: ++sequence, sourceRevision, archive: Uint8Array.from(archive) }
      nativeHostAcknowledged = false
      if (binding) binding.nativeHostCheckbox.checked = false
      notify('awaiting-confirmation')
      return controller.pending
    },
    cancel() {
      request = null
      nativeHostAcknowledged = false
      if (binding) binding.nativeHostCheckbox.checked = false
      notify('cancelled')
    },
    bindConfirmation(button, { nativeHostCheckbox }) {
      if (binding) throw new Error('Confirmation button is already bound')
      if (!button?.addEventListener || !nativeHostCheckbox)
        throw new TypeError('A confirmation button and native host checkbox are required')
      binding = { button, nativeHostCheckbox }
      nativeHostAcknowledged = false
      nativeHostCheckbox.checked = false
      const click = (event) => {
        void controller.confirmFromEvent(event)
      }
      const acknowledge = (event) => {
        const BrowserEvent = button.ownerDocument.defaultView.Event
        nativeHostAcknowledged =
          event instanceof BrowserEvent &&
          event.isTrusted &&
          event.currentTarget === nativeHostCheckbox &&
          nativeHostCheckbox.checked
      }
      button.addEventListener('click', click)
      nativeHostCheckbox.addEventListener('change', acknowledge)
      return () => {
        button.removeEventListener('click', click)
        nativeHostCheckbox.removeEventListener('change', acknowledge)
        binding = null
        controller.cancel()
      }
    },
    async confirmFromEvent(event) {
      const bound = binding
      const BrowserEvent = bound?.button.ownerDocument?.defaultView?.Event
      if (
        !BrowserEvent ||
        !(event instanceof BrowserEvent) ||
        !event.isTrusted ||
        event.type !== 'click' ||
        event.currentTarget !== bound.button ||
        !bound.button.isConnected ||
        bound.button.disabled ||
        !bound.button.getClientRects().length ||
        !bound.nativeHostCheckbox.checked ||
        !nativeHostAcknowledged
      )
        return { status: 'confirmation-required' }
      if (!request || busy) return { status: 'idle' }
      const current = request
      busy = true
      notify('selecting-device')
      try {
        // Invoke synchronously in the trusted click task to retain user activation.
        const port = await requestPort()
        if (request !== current) return { status: 'cancelled' }
        notify('transferring')
        const result = await installTransferArchive({
          archive: current.archive,
          port,
          loaderFactory,
          onLog,
          isCurrent: () => request === current,
          onProgress: (progress) => notify('transferring', { progress }),
        })
        request = null
        notify(result.status, { result })
        return result
      } catch (error) {
        request = null
        const status = error?.name === 'NotFoundError' ? 'cancelled' : 'error'
        notify(status, { error: String(error?.message ?? error) })
        return { status, error: String(error?.message ?? error) }
      } finally {
        busy = false
        nativeHostAcknowledged = false
        if (bound) bound.nativeHostCheckbox.checked = false
        notify('settled')
      }
    },
  }
  return controller
}
