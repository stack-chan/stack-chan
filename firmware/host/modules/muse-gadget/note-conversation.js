const format = Object.freeze({ encoding: 'pcm_s16le', sampleRate: 16000, channels: 1 })
const fault = (code) => Object.assign(new Error(code), { code })

export function createMuseNoteConversation({
  openBackend,
  createPcmSink,
  playReply,
  createScope = () => new AbortController(),
  onDiagnostic,
  maxRecordingBytes = 480000,
}) {
  if (
    !Number.isSafeInteger(maxRecordingBytes) ||
    maxRecordingBytes < 2 ||
    maxRecordingBytes > 480000 ||
    maxRecordingBytes % 2
  )
    throw new RangeError('invalid recording budget')
  return {
    capabilities: Object.freeze({
      interruption: 'local-only',
      historyRepair: 'restart',
      textInput: false,
      imageInput: false,
      inputRoles: [],
      interruptionReuse: 'restart-required',
      turnControl: 'client',
      submitCompletion: 'unavailable',
    }),
    audio: { input: [format], output: [format], duplex: 'half' },
    async open({ media, signal, history, onEvent }) {
      if (history.length) throw fault('unsupported_capability')
      if (signal.aborted) throw fault('cancelled')
      const lifetime = createScope()
      let backend,
        link,
        recording,
        length = 0,
        busy = false,
        closed = false,
        closeTask,
        turn = 0,
        epoch = 0,
        playbackGeneration = 0,
        playbackFence
      let turnScope,
        activePcm,
        activeTurnId,
        interrupted = false,
        remoteUnconfirmed = false
      const fencePlayback = () => {
        playbackFence ??= media.output.fence(++playbackGeneration)
        return playbackFence
      }
      const clearRecording = () => {
        recording?.fill(0)
        recording = undefined
        length = 0
      }
      const active = () => {
        if (closed || signal.aborted) throw fault('cancelled')
        if (interrupted) throw fault('cancelled_unconfirmed')
      }
      const emit = (event) => {
        if (!closed && !signal.aborted) onEvent(event)
      }
      const capture = createPcmSink(format, (bytes) => {
        if (!recording || closed || signal.aborted) return
        if (bytes.byteLength % 2 || length + bytes.byteLength > maxRecordingBytes) {
          clearRecording()
          emit({ type: 'error', code: 'resource_exhausted', fatal: false })
          return
        }
        recording.set(bytes, length)
        length += bytes.byteLength
      })
      const close = (options = { mode: 'abort' }) => {
        if (closeTask) return closeTask
        const hadPendingTurn = busy || remoteUnconfirmed
        const ownedLink = link,
          ownedBackend = backend
        link = backend = undefined
        closed = true
        epoch++
        clearRecording()
        signal.removeEventListener('abort', abort)
        turnScope?.abort()
        activePcm?.fill(0)
        lifetime.abort()
        closeTask = Promise.resolve().then(async () => {
          const results = await Promise.allSettled([
            Promise.resolve().then(() => ownedLink?.close()),
            Promise.resolve().then(() => ownedBackend?.close()),
            Promise.resolve().then(fencePlayback),
          ])
          const failed = results.find((result) => result.status === 'rejected')
          if (failed) throw failed.reason
          return {
            reason: options.mode === 'drain' && !hadPendingTurn ? 'drained' : 'aborted',
            remoteFinalization: hadPendingTurn ? 'unknown' : 'not-required',
          }
        })
        return closeTask
      }
      const abort = () => {
        void close({ mode: 'abort' }).catch(() => {})
      }
      signal.addEventListener('abort', abort)
      try {
        backend = await openBackend({ signal: lifetime.signal })
        if (closed || signal.aborted) {
          await backend.close()
          throw fault('cancelled')
        }
        active()
        link = await media.media.connect(media.input, capture, {
          signal: lifetime.signal,
          budget: { maxBufferedBytes: 6400, maxBufferedMs: 200 },
        })
        if (closed || signal.aborted) {
          await link.close()
          throw fault('cancelled')
        }
        active()
        void link.done.catch(() => {
          if (!closed) {
            emit({ type: 'error', code: 'input_overrun', fatal: true })
            void close({ mode: 'abort' }).catch(() => {})
          }
        })
      } catch (error) {
        await close({ mode: 'abort' }).catch(() => {})
        throw error
      }
      const submitRecording = (pcm) => {
        const current = ++epoch
        playbackFence = undefined
        const turnId = `muse-note-${++turn}`
        activeTurnId = turnId
        turnScope = createScope()
        const turnSignal = turnScope.signal
        busy = true
        activePcm = pcm
        emit({ type: 'turn.started', turnId })
        let stage = 'upload'
        void Promise.resolve()
          .then(async () => {
            if (closed || current !== epoch || turnSignal.aborted) return
            onDiagnostic?.('note_stage_upload')
            const response = await backend.sendNote(pcm, { signal: turnSignal })
            if (closed || current !== epoch || turnSignal.aborted) return
            if (response.status !== 'completed') throw fault('provider_failed')
            const messages = response.messages ?? []
            for (const message of messages) {
              if (message.text) emit({ type: 'output.text', outputId: message.id, delta: message.text })
            }
            stage = 'playback'
            onDiagnostic?.('note_stage_playback')
            if (playReply) {
              for (const message of messages) {
                const receipts = await playReply(message, { backend, media, signal: turnSignal, generation: playbackGeneration, fencePlayback })
                if (closed || current !== epoch || turnSignal.aborted) return
                for (const receipt of receipts ?? []) emit({ type: 'output.playback', receipt })
              }
            }
            emit({ type: 'turn.ended', turnId, status: 'completed' })
          })
          .catch((error) => {
            onDiagnostic?.(`note_failed_${stage}`)
            const code = ['resource_exhausted', 'deadline_exceeded', 'device_busy', 'cancelled', 'provider_failed'].includes(error?.code) ? error.code : 'unknown'
            onDiagnostic?.(`note_error_${code}`)
            if (closed || current !== epoch || turnSignal.aborted) return
            emit({ type: 'error', code: 'provider_failed', fatal: false })
            emit({ type: 'turn.ended', turnId, status: 'failed' })
          })
          .finally(() => {
            pcm.fill(0)
            if (activePcm === pcm) activePcm = undefined
            if (current === epoch) {
              busy = false
              turnScope = undefined
              activeTurnId = undefined
            }
          })
      }
      return {
        id: backend.id ?? 'muse-note',
        async submit() {
          throw fault('unsupported_capability')
        },
        async setInputEnabled(enabled) {
          active()
          if (enabled) {
            if (busy) throw fault('device_busy')
            if (!recording) {
              recording = new Uint8Array(maxRecordingBytes)
              length = 0
            }
            return
          }
          if (!recording) return
          const pcm = recording.subarray(0, length)
          recording = undefined
          length = 0
          if (pcm.byteLength) submitRecording(pcm)
        },
        async interrupt() {
          active()
          clearRecording()
          epoch++
          interrupted = true
          remoteUnconfirmed ||= busy
          turnScope?.abort()
          activePcm?.fill(0)
          if (activeTurnId) emit({ type: 'turn.ended', turnId: activeTurnId, status: 'interrupted' })
          activeTurnId = undefined
          busy = false
          return { playback: await fencePlayback(), remote: 'continued', history: 'restart-required' }
        },
        close,
      }
    },
  }
}
