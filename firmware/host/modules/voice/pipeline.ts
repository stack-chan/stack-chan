import type {
  CloseOptions,
  CloseResult,
  ConversationPipeline,
  ConversationSession,
  DuplexLease,
  InputMessage,
  PipelineOptions,
  Scope,
} from 'stackchan/voice/contracts'
import { createVoiceScope, requireActive, voiceError } from 'stackchan/voice/scope'

export function createConversationPipeline(options: PipelineOptions): ConversationPipeline {
  const { microphone, speaker, conversation } = options
  let startTask: Promise<void> | undefined
  let started = false
  let closeTask: Promise<CloseResult> | undefined
  let lease: DuplexLease | undefined
  let session: ConversationSession | undefined
  let scope: ReturnType<typeof createVoiceScope>
  let muted = options.microphoneMuted ?? false
  let appliedMute: boolean | undefined
  let volume: number | undefined
  let gate = Promise.resolve()
  const active = () => {
    if (!session || closeTask || scope?.signal.aborted) throw voiceError('cancelled', 'conversation is not active')
    return session
  }
  async function release() {
    // A failed session close can leave a native callback using the port. Keep the lease quarantined.
    await lease?.close()
    lease = undefined
  }
  const close = (args: CloseOptions = { mode: 'abort' }): Promise<CloseResult> => {
    if (closeTask) return closeTask
    const starting = !started
    closeTask = Promise.resolve()
      .then(async () => {
        if (starting) scope?.abort()
        await startTask?.catch(() => {})
        const result = await session?.close(args)
        scope?.abort()
        await gate.catch(() => {})
        await release()
        return result ?? { reason: 'aborted' as const, remoteFinalization: 'not-required' as const }
      })
      .finally(() => scope?.dispose())
    return closeTask
  }
  function start(parent?: Scope) {
    if (startTask || closeTask) return Promise.reject(voiceError('device_busy', 'pipeline is single-use'))
    scope = createVoiceScope(parent?.signal)
    startTask = Promise.resolve()
      .then(async () => {
        requireActive(scope.signal)
        if (!microphone || !speaker || microphone.runtime !== speaker.runtime)
          throw voiceError('unsupported_capability', 'microphone and speaker must share a runtime')
        lease = await microphone.runtime.acquire(microphone, speaker, conversation.audio, {
          budget: options.mediaBudget ?? { maxBufferedMs: 250, maxBufferedBytes: 24000 },
          signal: scope.signal,
        })
        requireActive(scope.signal)
        if (volume !== undefined) lease.setVolume(volume)
        if (muted) await lease.setInputEnabled(false)
        session = await conversation.open({
          media: { input: lease.input, output: lease.output, media: lease.media },
          history: options.history ?? [],
          signal: scope.signal,
          onEvent(event) {
            try {
              options.onEvent?.(event)
            } finally {
              if (event.type === 'error' && event.fatal) void close({ mode: 'abort' }).catch(() => {})
            }
          },
        })
        requireActive(scope.signal)
        await applyMute(muted)
        requireActive(scope.signal)
        started = true
      })
      .catch(async (error) => {
        scope.abort(error)
        if (session) {
          await session.close({ mode: 'abort' })
          session = undefined
        }
        await release()
        scope.dispose()
        throw error
      })
    scope.signal.addEventListener('abort', () => {
      void close({ mode: 'abort' }).catch(() => {})
    })
    return startTask
  }
  async function applyMute(next: boolean) {
    const current = session
    const audio = lease
    if (!current || !audio || closeTask) return
    if (appliedMute === next) return
    await audio.setInputEnabled(false)
    appliedMute = true
    if (closeTask) return
    await current.setInputEnabled(!next)
    if (!next && !closeTask) {
      await audio.setInputEnabled(true)
      appliedMute = false
    }
  }
  return {
    capabilities: conversation.capabilities,
    start,
    close,
    async submit(message: InputMessage, subScope?: Scope) {
      const caps = conversation.capabilities
      if (
        !caps.inputRoles.includes(message.role) ||
        message.content.some((part) => (part.type === 'input_text' ? !caps.textInput : !caps.imageInput))
      )
        throw voiceError('unsupported_capability', 'message is not supported by this conversation')
      return active().submit(message, subScope ?? scope)
    },
    async interrupt() {
      const result = await active().interrupt()
      if (result.history === 'restart-required') await close({ mode: 'abort' })
      return result
    },
    setVolume(gain: number) {
      if (!Number.isFinite(gain) || gain < 0 || gain > 1) throw new RangeError('volume')
      if (closeTask) throw voiceError('cancelled', 'pipeline is closed')
      volume = gain
      lease?.setVolume(gain)
    },
    setMicrophoneMuted(next: boolean) {
      if (closeTask) return Promise.reject(voiceError('cancelled', 'pipeline is closed'))
      muted = next
      if (!startTask) return Promise.resolve()
      gate = gate
        .catch(() => {})
        .then(async () => {
          await startTask
          if (closeTask) throw voiceError('cancelled', 'pipeline is closing')
          await applyMute(next)
        })
      return gate
    },
  }
}
