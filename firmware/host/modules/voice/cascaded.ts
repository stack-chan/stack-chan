import type {
  AgentResult,
  CascadedOptions,
  CloseOptions,
  CloseResult,
  Conversation,
  ConversationEvent,
  ConversationSession,
  ConversationSubmission,
  Failure,
  InputItem,
  InputMessage,
  Interruption,
  MediaLink,
  OutputMessage,
  Transcription,
  TurnDetector,
  TurnResult,
  TurnSignal,
} from 'stackchan/voice/contracts'
import { mono } from 'stackchan/voice/media'
import { createVoiceScope, requireActive, voiceError } from 'stackchan/voice/scope'
import Timer from 'timer'

let nextSession = 0
const historyLimit = 64 * 1024

function speechChunkLength(text: string, final: boolean) {
  const boundary = text.slice(0, 240).search(/[。！？.!?\n]/)
  if (boundary >= 0) return boundary + 1
  if (text.length < 240) return final ? text.length : 0
  const last = text.charCodeAt(239)
  return last >= 0xd800 && last <= 0xdbff ? 239 : 240
}

function errorCode(error: unknown): Failure['code'] {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined
  switch (code) {
    case 'unsupported_capability':
    case 'device_busy':
    case 'cancelled':
    case 'cancelled_unconfirmed':
    case 'deadline_exceeded':
    case 'input_overrun':
    case 'provider_failed':
    case 'resource_exhausted':
    case 'tool_failed':
      return code
    default:
      return 'provider_failed'
  }
}

function owned<T>(item: T, budget: { left: number }): T {
  function take(size: number) {
    budget.left -= size
    if (budget.left < 0) throw voiceError('resource_exhausted', 'conversation history budget exceeded')
  }
  if (item instanceof Uint8Array) {
    take(item.byteLength)
    return item.slice() as T
  }
  if (Array.isArray(item)) {
    take(item.length * 4)
    return item.map((value) => owned(value, budget)) as T
  }
  if (item && typeof item === 'object') {
    const copy: Record<string, unknown> = Object.create(null)
    for (const [key, value] of Object.entries(item)) {
      take(key.length * 2)
      copy[key] = owned(value, budget)
    }
    return copy as T
  }
  take(typeof item === 'string' ? item.length * 2 : 8)
  return item
}

export function createPushToTalk() {
  let target: Parameters<TurnDetector['start']>[0] | undefined
  let current: string | undefined
  const detector: TurnDetector = {
    preRollMs: 80,
    async start(options) {
      if (target) throw voiceError('device_busy')
      target = options
      return {
        async close() {
          target = undefined
          current = undefined
        },
        updateTranscript(value) {
          if (value.final) options.onSignal({ type: 'turn-ready', utteranceId: value.utteranceId })
        },
      }
    },
  }
  return {
    detector,
    press() {
      if (current || !target) return
      current = target.nextUtteranceId()
      target.onSignal({ type: 'speech-start', utteranceId: current })
    },
    release() {
      if (!current || !target) return
      target.onSignal({ type: 'speech-end', utteranceId: current })
      current = undefined
    },
  }
}

export function createCascadedConversation(config: CascadedOptions): Conversation {
  const imageInput = config.agent.capabilities?.image ?? false
  return {
    audio: {
      input: [mono(16000)],
      output: [mono(24000)],
      duplex: 'half',
      preRollMs: config.turnDetector.preRollMs ?? 0,
    },
    capabilities: {
      interruption: 'remote-cancel',
      interruptionReuse: 'reusable',
      historyRepair: 'truncate',
      textInput: true,
      imageInput,
      inputRoles: ['user', 'system', 'developer'],
      turnControl: 'client',
      submitCompletion: 'playback',
    },
    async open({ media: ports, signal, onEvent, history: initial }) {
      requireActive(signal)
      if (
        !imageInput &&
        initial.some((item) => item.type === 'message' && item.content.some((part) => part.type === 'input_image'))
      )
        throw voiceError('unsupported_capability', 'agent does not accept images in history')
      const id = `voice-${++nextSession}`
      const budget = { left: historyLimit }
      const seed = owned(initial, budget)
      const turns: { items: InputItem[]; size: number }[] = []
      let sequence = 0,
        generation = 0,
        enabled = true,
        closing = false
      let stopTask: Promise<CloseResult> | undefined
      let pending = Promise.resolve()
      let turn: { scope: ReturnType<typeof createVoiceScope>; done: Promise<void> } | undefined
      let utterance:
        | {
            id: string
            scope: ReturnType<typeof createVoiceScope>
            stt: Transcription
            link: MediaLink
            text: string
            finishing: boolean
            finished: boolean
            ready: boolean
            stopping?: Promise<void>
          }
        | undefined
      let detector: Awaited<ReturnType<TurnDetector['start']>>
      let interruptTask: Promise<Interruption> | undefined
      const sessionScope = createVoiceScope(signal)
      let mustRestart = false
      let failedCleanup: { error: unknown; stt: Transcription | undefined } | undefined
      function completedAgent(job: Promise<AgentResult>, scope: ReturnType<typeof createVoiceScope>) {
        return new Promise<AgentResult>((resolve, reject) => {
          let timer: ReturnType<typeof Timer.set> | undefined
          const abort = () => {
            timer = Timer.set(() => {
              mustRestart = true
              reject(voiceError('deadline_exceeded', 'agent cancellation timed out'))
            }, 500)
          }
          if (scope.signal.aborted) abort()
          else scope.signal.addEventListener('abort', abort)
          const clear = () => {
            if (timer !== undefined) Timer.clear(timer)
            scope.signal.removeEventListener('abort', abort)
          }
          void job.then(
            (value) => {
              clear()
              resolve(value)
            },
            (error) => {
              clear()
              reject(error)
            },
          )
        })
      }
      function send(event: ConversationEvent) {
        if (!closing) onEvent(event)
      }
      async function stopUtterance() {
        if (failedCleanup) throw failedCleanup.error
        const u = utterance
        if (!u) return
        if (u.stopping) return u.stopping
        u.scope.abort()
        u.stopping = (async () => {
          try {
            try {
              await u.link.close()
            } finally {
              await u.stt.close()
            }
            if (utterance === u) utterance = undefined
          } catch (error) {
            mustRestart = true
            failedCleanup = { error, stt: u.stt }
            throw error
          } finally {
            u.scope.dispose()
          }
        })()
        return u.stopping
      }
      function reserveTurn(size: number) {
        let used = turns.reduce((n, t) => n + t.size, 0)
        while (turns.length && (turns.length >= 12 || used + size > budget.left)) {
          used -= turns[0].size
          turns.shift()
        }
      }
      function remember(items: readonly InputItem[]) {
        const space = { left: budget.left }
        const copy = owned(items, space) as InputItem[]
        const size = budget.left - space.left
        reserveTurn(size)
        turns.push({ items: copy, size })
      }
      function submit(message: InputMessage, caller: { signal: typeof signal }): ConversationSubmission {
        requireActive(caller.signal)
        requireActive(sessionScope.signal)
        if (mustRestart) throw voiceError('provider_failed', 'an unconfirmed tool call requires a new session')
        if (closing || turn || interruptTask) throw voiceError('device_busy')
        if (!imageInput && message.content.some((part) => part.type === 'input_image'))
          throw voiceError('unsupported_capability', 'agent does not accept images')
        const space = { left: budget.left }
        const input = owned(message, space)
        reserveTurn(budget.left - space.left)
        const scope = createVoiceScope(sessionScope.signal)
        const cancel = () => {
          if (turn === record) void interrupt().catch(() => {})
        }
        caller.signal.addEventListener('abort', cancel)
        const turnId = `${id}/${++sequence}`,
          epoch = generation
        const record = { scope, done: Promise.resolve() }
        turn = record
        let status: TurnResult['status'] = 'failed'
        record.done = Promise.resolve().then(async () => {
          let appended: readonly InputItem[] = []
          const playback = new Map<string, { heard: string; pending: string; segments: number; early: boolean }>()
          const stateFor = (item: string) => {
            let state = playback.get(item)
            if (!state) {
              if (playback.size >= 32) throw voiceError('resource_exhausted', 'too many assistant messages')
              state = { heard: '', pending: '', segments: 0, early: true }
              playback.set(item, state)
            }
            return state
          }
          async function speak(itemId: string, segment: string) {
            requireActive(scope.signal)
            const state = stateFor(itemId)
            const outputId = `${itemId}/${state.segments++}`
            const synthesis = await config.tts.open({
              signal: scope.signal,
              format: ports.output.format,
              voice: config.voice,
            })
            let link: MediaLink | undefined
            try {
              requireActive(scope.signal)
              const sink = ports.output.begin(outputId, epoch)
              link = await ports.media.connect(synthesis.output, sink, {
                signal: scope.signal,
                budget: ports.output.budget,
              })
              await synthesis.write(segment)
              await synthesis.endInput()
              await link.done
              const receipt = await ports.output.finish(outputId)
              send({ type: 'output.playback', receipt })
              if (receipt.state !== 'played') throw voiceError('cancelled')
              state.heard += segment
            } finally {
              try {
                await link?.close()
              } finally {
                await synthesis.close()
              }
            }
          }
          let historyFailed = false
          let historyError: unknown
          try {
            requireActive(scope.signal)
            send({ type: 'turn.started', turnId })
            const job = config.agent.run(
              { input: [...seed, ...turns.flatMap((t) => t.items), input], sessionId: id, turnId },
              {
                signal: scope.signal,
                async onEvent(event) {
                  requireActive(scope.signal)
                  if (event.type !== 'response.output_text.delta') return
                  send({ type: 'output.text', outputId: event.item_id, delta: event.delta })
                  const state = stateFor(event.item_id)
                  if (event.phase !== 'final_answer') state.early = false
                  if (!state.early) return
                  if (state.heard.length + state.pending.length + event.delta.length > 4096)
                    throw voiceError('resource_exhausted', 'speech text too long')
                  state.pending += event.delta
                  for (;;) {
                    const length = speechChunkLength(state.pending, false)
                    if (!length) break
                    const sentence = state.pending.slice(0, length)
                    state.pending = state.pending.slice(length)
                    await speak(event.item_id, sentence)
                  }
                },
              },
            )
            const result = await completedAgent(job, scope)
            if ('error' in result && result.error.code === 'cancelled_unconfirmed') mustRestart = true
            const finalMessages =
              result.status === 'completed'
                ? result.response.output.filter(
                    (item): item is OutputMessage => item.type === 'message' && item.phase !== 'commentary',
                  )
                : []
            appended = result.appended
            requireActive(scope.signal)
            if (result.status === 'failed') throw voiceError(errorCode(result.error), result.error.message)
            if (result.status !== 'completed') throw voiceError('provider_failed', 'incomplete agent turn')
            for (const item of finalMessages) {
              const text = item.content.map((part) => (part.type === 'output_text' ? part.text : part.refusal)).join('')
              if (text.length > 4096) throw voiceError('resource_exhausted', 'speech text too long')
              const state = stateFor(item.id)
              if (!text.startsWith(state.heard)) {
                mustRestart = true
                throw voiceError('provider_failed', 'authoritative final text differs from spoken audio')
              }
              let rest = text.slice(state.heard.length)
              while (rest) {
                const length = speechChunkLength(rest, true)
                await speak(item.id, rest.slice(0, length))
                rest = rest.slice(length)
              }
            }
            status = 'completed'
          } catch (error) {
            if (scope.signal.aborted) status = 'interrupted'
            else {
              scope.abort(error)
              await ports.output.fence(++generation)
              send({ type: 'error', code: errorCode(error), fatal: false })
            }
          } finally {
            try {
              const items: InputItem[] = [input]
              for (const item of appended) {
                if (item.type !== 'message' || item.role !== 'assistant' || item.phase === 'commentary') {
                  items.push(item)
                  continue
                }
                const heard = playback.get(item.id)?.heard
                if (heard) items.push({ ...item, content: [{ type: 'output_text', text: heard }] })
                playback.delete(item.id)
              }
              for (const [itemId, state] of playback) {
                if (state.heard)
                  items.push({
                    type: 'message',
                    role: 'assistant',
                    id: itemId,
                    phase: 'final_answer',
                    content: [{ type: 'output_text', text: state.heard }],
                  })
              }
              remember(items)
            } catch (error) {
              status = 'failed'
              mustRestart = true
              historyFailed = true
              historyError = error
            } finally {
              scope.dispose()
              caller.signal.removeEventListener('abort', cancel)
              if (turn === record) turn = undefined
              send({ type: 'turn.ended', turnId, status })
            }
          }
          if (historyFailed) throw historyError
        })
        const done = record.done.then(
          () => ({ turnId, status }),
          (error) => {
            try {
              send({ type: 'error', code: errorCode(error), fatal: true })
            } catch {
              // Observer failures cannot leave the accepted turn without a terminal result.
            }
            return { turnId, status: 'failed' as const }
          },
        )
        return { completion: 'playback', id: turnId, done }
      }
      function interrupt(): Promise<Interruption> {
        if (interruptTask) return interruptTask
        const running = turn
        const fenced = ports.output.fence(++generation)
        running?.scope.abort()
        interruptTask = Promise.resolve(fenced)
          .then(async (playback) => {
            await running?.done
            return {
              playback,
              remote: 'unknown' as const,
              history: mustRestart ? ('restart-required' as const) : ('conservative' as const),
            }
          })
          .finally(() => {
            interruptTask = undefined
          })
        return interruptTask
      }
      function enqueue(task: () => void | Promise<void>) {
        pending = pending.then(task).catch(async (error) => {
          try {
            await stopUtterance()
          } catch (cleanupError) {
            error = cleanupError
          }
          send({ type: 'error', code: errorCode(error), fatal: !!failedCleanup })
        })
      }
      async function handle(event: TurnSignal) {
        if (closing || !enabled || mustRestart) return
        if (event.type === 'speech-start') {
          if (turn && (await interrupt()).history === 'restart-required') {
            send({ type: 'error', code: 'provider_failed', fatal: true })
            return
          }
          await stopUtterance()
          const scope = createVoiceScope(sessionScope.signal)
          let stt: Transcription | undefined
          try {
            stt = await config.stt.open({
              signal: scope.signal,
              utteranceId: event.utteranceId,
              format: ports.input.format,
              onTranscript(value) {
                if (utterance?.id !== value.utteranceId || scope.signal.aborted || closing || !enabled) return
                if (value.final) utterance.text = value.text
                send({ type: 'input.transcript', value })
                detector.updateTranscript(value)
              },
            })
            requireActive(scope.signal)
            const link = await ports.media.connect(ports.input, stt.input, {
              signal: scope.signal,
              budget: ports.output.budget,
              replayMs: config.turnDetector.preRollMs ?? 0,
            })
            const current = {
              id: event.utteranceId,
              scope,
              stt,
              link,
              text: '',
              finishing: false,
              finished: false,
              ready: false,
            }
            utterance = current
            void link.done.catch(() => {
              if (utterance === current && !scope.signal.aborted) {
                scope.abort()
                send({ type: 'error', code: 'input_overrun', fatal: false })
              }
            })
          } catch (error) {
            scope.abort()
            try {
              await stt?.close()
            } catch (cleanupError) {
              mustRestart = true
              failedCleanup = { error: cleanupError, stt }
              throw cleanupError
            }
            throw error
          }
        } else if (utterance?.id === event.utteranceId) {
          const current = utterance
          if (event.type === 'speech-end') {
            if (current.finishing) return
            current.finishing = true
            await current.link.close()
            // 認識結果待ちで次のspeech-startを塞がず、新しい発話から古い認識を取り消せるようにする
            void Promise.resolve()
              .then(() => {
                requireActive(current.scope.signal)
                return current.stt.finish()
              })
              .then(
                () => {
                  enqueue(async () => {
                    if (utterance !== current || current.scope.signal.aborted) return
                    current.finished = true
                    if (current.ready) await handle({ type: 'turn-ready', utteranceId: current.id })
                  })
                },
                (error) => {
                  enqueue(() => {
                    if (utterance === current && !current.scope.signal.aborted) throw error
                  })
                },
              )
          } else {
            current.ready = true
            if (current.finishing && !current.finished) return
            const text = current.text
            await stopUtterance()
            if (text.trim())
              submit({ type: 'message', role: 'user', content: [{ type: 'input_text', text }] }, sessionScope)
          }
        }
      }
      try {
        detector = await config.turnDetector.start({
          signal: sessionScope.signal,
          audio: ports.input,
          nextUtteranceId: () => `${id}/u${++sequence}`,
          onSignal(event) {
            enqueue(() => handle(event))
          },
        })
      } catch (error) {
        sessionScope.abort()
        throw error
      }

      const session: ConversationSession = {
        id,
        async submit(message, scope) {
          return submit(message, scope)
        },
        async setInputEnabled(value) {
          enabled = value
          if (!value) {
            utterance?.scope.abort()
            await pending
            await stopUtterance()
          }
        },
        interrupt,
        close(options: CloseOptions) {
          if (stopTask) return stopTask
          closing = true
          stopTask = (async () => {
            let reason: CloseResult['reason'] = options.mode === 'abort' ? 'aborted' : 'drained'
            let timer: ReturnType<typeof Timer.set> | undefined
            try {
              if (options.mode === 'drain' && turn) {
                const timeout = new Promise<void>((resolve) => {
                  timer = Timer.set(() => {
                    reason = 'drain-timeout'
                    resolve()
                  }, options.timeoutMs ?? 5000)
                })
                await Promise.race([turn.done, timeout])
              }
              sessionScope.abort()
              if (reason !== 'drained') await interrupt()
              await detector.close()
              await pending
              await stopUtterance()
              return { reason, remoteFinalization: mustRestart ? ('unknown' as const) : ('not-required' as const) }
            } finally {
              if (timer !== undefined) Timer.clear(timer)
              sessionScope.dispose()
            }
          })()
          return stopTask
        },
      }
      return session
    },
  }
}
