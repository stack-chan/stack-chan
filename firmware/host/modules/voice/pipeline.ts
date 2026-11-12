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
  let closeTask: Promise<CloseResult> | undefined
  let lease: DuplexLease | undefined
  let session: ConversationSession | undefined
  let scope: ReturnType<typeof createVoiceScope>
  let muted = false
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
    const starting = !session
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
          budget: options.mediaBudget,
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
        if (muted) await session.setInputEnabled(false)
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
  return {
    start,
    close,
    submit(message: InputMessage, subScope?: Scope) {
      return active().submit(message, subScope ?? scope)
    },
    async interrupt() {
      const result = await active().interrupt()
      if (result.history === 'restart-required') await close({ mode: 'abort' })
      return result
    },
    setVolume(gain: number) {
      if (!Number.isFinite(gain) || gain < 0 || gain > 1) throw new RangeError('volume')
      volume = gain
      lease?.setVolume(gain)
    },
    setMuted(next: boolean) {
      const current = active()
      const audio = lease
      if (!audio) throw voiceError('cancelled')
      gate = gate
        .catch(() => {})
        .then(async () => {
          if (muted === next) return
          await audio.setInputEnabled(false)
          muted = true
          await current.setInputEnabled(!next)
          if (!next && !closeTask) {
            await audio.setInputEnabled(true)
            muted = false
          }
        })
      return gate
    },
  }
}
