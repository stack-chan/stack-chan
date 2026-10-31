import { createContext } from '../../firmware/mods/examples/avatar-dsl/context.js'
import { checkSource, createEditorModel, createPreviewService, MAX_SOURCE_BYTES } from './editor-model.mjs'
import { guide, samples } from './samples.mjs'
import { createTools, registerWebMCP } from './webmcp.mjs'
import { createTransferController } from './transfer.mjs'
import { buildTransferArchiveInWorker } from './transfer-browser.mjs'

export function mountEditor(root) {
  const lifecycle = new AbortController()
  const listen = (target, name, handler, options = {}) =>
    target.addEventListener(name, handler, { ...options, signal: lifecycle.signal })
  const el = (id) => root.querySelector(`#${id}`)
  const model = createEditorModel(samples.default)
  const preview = createPreviewService(
    () => new Worker(new URL('./preview.worker.mjs', import.meta.url), { type: 'module' })
  )
  let compiled,
    draftValid = true,
    debounce,
    preparing = false,
    preparation,
    releaseRequestSignal
  const diagnostic = (text, error = false) => {
    el('diagnostic').textContent = text
    el('diagnostic').dataset.error = String(error)
  }
  const transfer = createTransferController({
    onLog: (message) => {
      if (!lifecycle.signal.aborted) el('transfer-status').textContent = String(message)
    },
    onState: (state) => {
      if (lifecycle.signal.aborted) return
      if (state.status !== 'settled')
        el('transfer-status').textContent =
          state.status === 'cancelled' ? 'cancelled' : state.error?.message || state.error || state.status
      if (state.status === 'selecting-device') el('confirmation').close()
      el('source').disabled = el('sample').disabled = el('load').disabled = state.busy
      el('undo').disabled = state.busy || !model.canUndo
      for (const id of ['eye', 'mouth', 'gaze', 'breath', 'expression', 'validate', 'transfer'])
        el(id).disabled = state.busy || (id === 'transfer' && !compiled)
    },
  })
  const context = () => {
    const ctx = createContext()
    ctx[4] = Number(el('breath').value)
    ctx[5] = Number(el('eye').value)
    ctx[6] = Number(el('gaze').value)
    ctx[8] = ctx[31] = Number(el('mouth').value)
    ctx[9] = Number(el('expression').value)
    return ctx
  }
  function cancelTransfer() {
    preparation?.abort()
    releaseRequestSignal?.()
    releaseRequestSignal = undefined
    transfer.cancel()
    if (el('confirmation').open) el('confirmation').close()
    el('compatible-host').checked = false
    el('confirm-transfer').disabled = true
  }
  function invalidate() {
    compiled = undefined
    el('bytecode').disabled = el('transfer').disabled = true
    cancelTransfer()
    preview.cancel()
  }
  async function validate() {
    clearTimeout(debounce)
    if (!draftValid) throw new Error('Correct the source limit before preview or transfer')
    const revision = model.revision
    diagnostic('コンパイル・C / WASM 描画中…')
    try {
      const output = await preview.run(model.source, context())
      if (lifecycle.signal.aborted) throw new Error('Preview cancelled')
      if (revision !== model.revision) throw new Error('Editor changed')
      compiled = { ...output, revision }
      const result = output.result
      el('preview')
        .getContext('2d')
        .putImageData(new ImageData(new Uint8ClampedArray(result.pixels), 320, 240), 0, 0)
      diagnostic(`検証 OK · ${output.bytecode.byteLength} bytes · ${result.steps} instructions`)
      el('render-status').textContent = `C / WASM · Revision ${revision} · 選択した表情の描画に成功`
      el('bytecode').disabled = el('transfer').disabled = false
      return compiled
    } catch (error) {
      if (!lifecycle.signal.aborted && error.message !== 'Preview cancelled') {
        compiled = undefined
        el('bytecode').disabled = el('transfer').disabled = true
        diagnostic(error.message, true)
        el('render-status').textContent = '描画は更新されていません。最後に成功したプレビューです。'
      }
      throw error
    }
  }
  function changed() {
    draftValid = true
    if (el('source').value !== model.source) el('source').value = model.source
    el('line-numbers').textContent = model.source
      .split('\n')
      .map((_, index) => index + 1)
      .join('\n')
    el('line-numbers').scrollTop = el('source').scrollTop
    el('revision').textContent = `Revision ${model.revision}`
    el('undo').disabled = !model.canUndo
    invalidate()
    diagnostic('変更あり · 検証待ち')
    clearTimeout(debounce)
    debounce = setTimeout(() => void validate().catch(() => {}), 300)
  }
  async function requestTransfer(expectedRevision = model.revision, signal) {
    if (preparing || transfer.busy) throw new Error('Transfer preparation or installation is already running')
    if (!draftValid || expectedRevision !== model.revision) throw new Error('Editor changed; validate current source')
    preparing = true
    preparation = new AbortController()
    const buildSignal = AbortSignal.any([lifecycle.signal, preparation.signal, ...(signal ? [signal] : [])])
    try {
      const output = await validate()
      if (buildSignal.aborted) throw new Error('Request cancelled')
      el('transfer-status').textContent = 'MOD アーカイブを構築中…'
      const archive = await buildTransferArchiveInWorker(output.bytecode, {
        signal: buildSignal,
        onLog: (message) => {
          if (!buildSignal.aborted) el('transfer-status').textContent = String(message)
        },
      })
      if (buildSignal.aborted || model.revision !== expectedRevision || !draftValid)
        throw new Error('Request cancelled or editor changed')
      transfer.stage({ archive, sourceRevision: expectedRevision })
      if (signal) {
        signal.addEventListener('abort', cancelTransfer, { once: true })
        releaseRequestSignal = () => signal.removeEventListener('abort', cancelTransfer)
      }
      el('confirm-transfer').disabled = true
      el('transfer-snapshot').textContent = `Revision ${expectedRevision} · AVBC ${output.bytecode.byteLength} bytes`
      el('confirmation').showModal()
      return { status: 'awaiting_user_confirmation', revision: expectedRevision }
    } finally {
      preparation = undefined
      preparing = false
    }
  }
  const report = (action) =>
    Promise.resolve()
      .then(action)
      .catch((error) => {
        if (!lifecycle.signal.aborted) diagnostic(error.message, true)
      })
  listen(el('source'), 'input', () => {
    try {
      model.replace(checkSource(el('source').value))
      changed()
    } catch (error) {
      draftValid = false
      invalidate()
      diagnostic(error.message, true)
    }
  })
  listen(el('source'), 'keydown', (event) => {
    if (event.ctrlKey || event.metaKey) {
      if (event.key === 'Enter') {
        event.preventDefault()
        report(validate)
        return
      }
      if (event.key.toLowerCase() === 's') {
        event.preventDefault()
        download(el('source').value, 'face.avdsl', 'text/plain;charset=utf-8')
        return
      }
      if (event.key.toLowerCase() === 'z' && !event.shiftKey) {
        event.preventDefault()
        model.undo()
        changed()
        return
      }
    }
    if (event.key !== 'Tab') return
    event.preventDefault()
    const source = el('source')
    source.setRangeText('  ', source.selectionStart, source.selectionEnd, 'end')
    source.dispatchEvent(new Event('input'))
  })
  listen(el('source'), 'scroll', () => {
    el('line-numbers').scrollTop = el('source').scrollTop
  })
  listen(el('sample'), 'change', () => {
    model.replace(samples[el('sample').value])
    changed()
  })
  listen(el('undo'), 'click', () => {
    model.undo()
    changed()
  })
  listen(el('validate'), 'click', () => report(validate))
  for (const name of ['eye', 'mouth', 'gaze', 'breath', 'expression'])
    listen(el(name), 'input', () => {
      invalidate()
      report(validate)
    })
  el('guide').textContent = guide
  listen(el('load'), 'click', () => el('file').click())
  listen(el('file'), 'change', () =>
    report(async () => {
      try {
        const file = el('file').files[0]
        if (!file) return
        if (file.size > MAX_SOURCE_BYTES) throw new Error('DSL exceeds 32 KiB')
        model.replace(await file.text())
        changed()
      } finally {
        el('file').value = ''
      }
    })
  )
  function download(data, name, type) {
    const url = URL.createObjectURL(new Blob([data], { type }))
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  listen(el('download'), 'click', () => download(el('source').value, 'face.avdsl', 'text/plain;charset=utf-8'))
  listen(el('bytecode'), 'click', () => {
    if (compiled?.revision === model.revision) download(compiled.bytecode, 'face.avbc', 'application/octet-stream')
  })
  listen(el('transfer'), 'click', () => report(() => requestTransfer()))
  listen(el('cancel-transfer'), 'click', cancelTransfer)
  listen(el('confirmation'), 'cancel', cancelTransfer)
  listen(el('compatible-host'), 'change', (event) => {
    el('confirm-transfer').disabled = !event.isTrusted || !el('compatible-host').checked
  })
  const unbind = transfer.bindConfirmation(el('confirm-transfer'), { nativeHostCheckbox: el('compatible-host') })
  const tools = createTools({
    model,
    guide,
    samples,
    changed,
    requestTransfer,
    assertEditable: () => {
      if (transfer.busy) throw new Error('Device transfer is in progress')
      if (!draftValid) throw new Error('Resolve the current oversized draft before an agent changes the editor')
    },
  })
  let bridge
  registerWebMCP(tools, { signal: lifecycle.signal }).then((result) => {
    if (lifecycle.signal.aborted) {
      result.dispose?.()
      return
    }
    bridge = result
    el('bridge-status').textContent = result.supported ? 'WebMCP tools available' : result.reason
  })
  const dispose = () => {
    clearTimeout(debounce)
    lifecycle.abort()
    bridge?.dispose?.()
    preview.cancel()
    unbind()
    cancelTransfer()
  }
  listen(window, 'pagehide', (event) => {
    if (!event.persisted) {
      dispose()
      return
    }
    // A cached Document keeps this React mount, its draft/history and WebMCP
    // registrations. Cancel transient work without aborting its listeners.
    clearTimeout(debounce)
    invalidate()
  })
  listen(window, 'pageshow', (event) => {
    // Recompile the retained draft/context, without replacing an oversized
    // textarea draft with the model's last accepted source.
    if (event.persisted && draftValid) report(validate)
  })
  changed()
  return dispose
}
