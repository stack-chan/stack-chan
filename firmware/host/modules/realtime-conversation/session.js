const unsupported = (message) => Object.assign(new Error(message), { code: 'unsupported_capability' })

export function liveConversation(options, platform) {
  const delegation = options.delegation ?? { kind: 'none' }
  if (!['none', 'hosted', 'client'].includes(delegation.kind)) throw unsupported('Unknown delegation mode')
  if (options.tools) throw unsupported('GPT-Live tools belong to the delegated agent')
  if (delegation.kind === 'client' && typeof delegation.delegate?.run !== 'function')
    throw new TypeError('Missing delegate')
  if (delegation.kind === 'hosted' && !delegation.model) throw new TypeError('Missing hosted model')
  return {
    audio: platform.audio,
    capabilities: {
      interruption: 'local-only',
      interruptionReuse: 'restart-required',
      historyRepair: 'restart',
      textInput: false,
      imageInput: false,
      inputRoles: [],
      turnControl: 'provider',
      submitCompletion: 'unavailable',
    },
    async open({ media, history = [], onEvent = (_event) => {}, signal }) {
      if (history.length) throw unsupported('GPT-Live cannot import a conversation history')
      if (signal?.aborted) throw signal.reason ?? new Error('Cancelled')
      const handle = platform.borrowLiveAudio(media.input, media.output)
      const scope = platform.createVoiceScope(signal)
      const fragments = [],
        delegated = new Set()
      let chars = 0,
        closing,
        fenced,
        sessionId,
        protocol,
        outputId,
        ongoing = 0,
        serial = 0
      const snapshot = (offset) =>
        fragments
          .filter((fragment) => fragment.end_ms <= offset)
          .map((f) =>
            f.role === 'user'
              ? { type: 'message', role: 'user', content: [{ type: 'input_text', text: f.delta }] }
              : { type: 'message', id: f.id, role: 'assistant', content: [{ type: 'output_text', text: f.delta }] },
          )
      async function delegate(event) {
        const id = event.delegation?.id
        if (delegation.kind !== 'client' || event.delegation?.target !== 'client' || !id || delegated.has(id)) return
        if (delegated.size >= 256 || ongoing >= 4) throw new Error('Live delegation limit exceeded')
        delegated.add(id)
        ongoing++
        const child = platform.createVoiceScope(scope.signal)
        let timer, onAbort
        try {
          timer = platform.setTimer(() => child.abort(new Error('Delegation deadline exceeded')), 30000)
          const aborted = new Promise((_, reject) => {
            onAbort = () => reject(child.signal.reason ?? new Error('Cancelled'))
            child.signal.addEventListener('abort', onAbort)
          })
          const result = await Promise.race([
            delegation.delegate.run(
              { delegationId: id, sessionId, turnId: id, input: snapshot(event.offset_ms) },
              { signal: child.signal },
            ),
            aborted,
          ])
          if (child.signal.aborted) return
          let content = ''
          for (const item of result) {
            if (item.type !== 'message' || item.role !== 'assistant' || item.phase === 'commentary') continue
            for (const part of item.content) {
              const text = part.type === 'output_text' ? part.text : part.type === 'refusal' ? part.refusal : ''
              if (text.length + content.length > 4096) throw new Error('Delegated result exceeds budget')
              content += text
            }
          }
          if (!content) throw new Error('Missing delegated result')
          // A Unicode scalar encodes into at most four bytes. Keep every append below 500 tokens.
          const points = Array.from(content)
          for (let start = 0; start < points.length; start += 120)
            protocol.appendDelegationResult(id, points.slice(start, start + 120).join(''))
        } finally {
          if (timer !== undefined) platform.clearTimer(timer)
          if (onAbort) child.signal.removeEventListener('abort', onAbort)
          child.dispose()
          ongoing--
        }
      }
      const callback = (name, value) => options[name]?.(value)
      const settings = {
        ...options,
        delegation:
          delegation.kind === 'hosted'
            ? {
                type: 'responses',
                responses: { model: delegation.model, instructions: delegation.instructions },
              }
            : delegation.kind === 'client'
              ? { type: 'client' }
              : undefined,
        tools:
          delegation.kind === 'hosted'
            ? delegation.tools?.definitions.map((definition) => ({
                ...definition,
                execute: async (args, ctx) => {
                  if (!sessionId || scope.signal.aborted || ctx.isCancelled())
                    throw new Error('Tool execution cancelled')
                  const output = await delegation.tools.execute(
                    {
                      type: 'function_call',
                      id: ctx.itemId ?? ctx.callId,
                      call_id: ctx.callId,
                      name: definition.name,
                      arguments: JSON.stringify(args),
                    },
                    { sessionId, turnId: ctx.responseId, callId: ctx.callId, signal: scope.signal },
                  )
                  if (scope.signal.aborted || ctx.isCancelled()) throw new Error('Tool execution cancelled')
                  return output.output
                },
              }))
            : undefined,
        onError(error) {
          callback('onError', error)
          if (!closing) onEvent({ type: 'error', code: error.code ?? 'provider_failed', fatal: false })
        },
        onStateChanged(state) {
          callback('onStateChanged', state)
          if (!closing && sessionId && (state === 'closed' || state === 'error'))
            onEvent({ type: 'error', code: 'provider_closed', fatal: true })
        },
        onTranscript(fragment) {
          if (scope.signal.aborted) return
          callback('onTranscript', fragment)
          const id = 'fragment_' + ++serial
          if (delegation.kind === 'client') {
            const bounded = { ...fragment, id, delta: fragment.delta.slice(-8192) }
            fragments.push(bounded)
            chars += bounded.delta.length
            while (chars > 8192 || fragments.length > 128) chars -= fragments.shift().delta.length
          }
          if (fragment.role === 'user')
            onEvent({ type: 'input.transcript.delta', streamId: sessionId + '/input', delta: fragment.delta })
          else onEvent({ type: 'output.text', outputId, delta: fragment.delta })
        },
        onEvent(event) {
          callback('onEvent', event)
          if (event.type === 'session.started') sessionId = event.session.id
          if (event.type === 'session.delegation.created' && !scope.signal.aborted)
            void delegate(event).catch(() => {
              if (!scope.signal.aborted) onEvent({ type: 'error', code: 'delegation_failed', fatal: false })
            })
        },
      }
      const abortStart = () => {
        void protocol?.close(1)
      }
      signal?.addEventListener('abort', abortStart)
      try {
        protocol = platform.createProtocol(settings, handle)
        outputId = 'live-output'
        media.output.begin(outputId, 0)
        const started = await protocol.connect()
        sessionId = started.id
        if (signal?.aborted) throw signal.reason ?? new Error('Cancelled')
      } catch (error) {
        scope.abort(error)
        try {
          await media.output.fence(1)
        } finally {
          try {
            await protocol?.close(1)
          } finally {
            scope.dispose()
          }
        }
        throw error
      } finally {
        signal?.removeEventListener('abort', abortStart)
      }
      function stop(mode, timeoutMs = 15000) {
        if (closing) return closing
        protocol.stopTools?.()
        const end = Date.now() + Math.max(1, Math.min(60000, timeoutMs))
        closing = Promise.resolve().then(async () => {
          let reason = mode === 'drain' ? 'drained' : 'aborted',
            timer,
            remote
          scope.abort(new Error('Live session ended'))
          try {
            if (mode === 'drain') {
              const receipt = await Promise.race([
                media.output.finish(outputId),
                new Promise((resolve) => {
                  timer = platform.setTimer(() => resolve(undefined), Math.max(1, end - Date.now()))
                }),
              ])
              if (receipt) onEvent({ type: 'output.playback', receipt })
              else reason = 'drain-timeout'
            }
            if (reason !== 'drained') {
              fenced ??= media.output.fence(1)
              const receipts = await fenced
              for (const receipt of receipts) onEvent({ type: 'output.playback', receipt })
            }
          } finally {
            if (timer !== undefined) platform.clearTimer(timer)
            try {
              remote = await protocol.close(Math.max(1, end - Date.now()))
            } finally {
              scope.dispose()
            }
          }
          if (remote.reason === 'cleanup_error') throw new Error('WebRTC media did not stop')
          return { reason, remoteFinalization: remote.finalized ? 'confirmed' : 'unknown' }
        })
        return closing
      }
      return {
        id: sessionId,
        async submit() {
          throw unsupported('GPT-Live accepts speech input')
        },
        setInputEnabled(enabled) {
          return protocol.setMuted(!enabled)
        },
        async interrupt() {
          const result = await stop('abort', 1500)
          return {
            playback: await (fenced ?? []),
            remote: result.remoteFinalization === 'confirmed' ? 'cancelled' : 'unknown',
            history: 'restart-required',
          }
        },
        close({ mode, timeoutMs }) {
          return stop(mode, timeoutMs)
        },
      }
    },
  }
}
