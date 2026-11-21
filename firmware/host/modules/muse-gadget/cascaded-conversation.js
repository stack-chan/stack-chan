function failure(code) {
  return Object.assign(new Error(code), { code })
}

export function createMuseCascadedConversation({
  createConversation,
  createPushToTalk,
  createAgent,
  openChat,
  stt,
  tts,
  voice,
  onPlaybackState,
}) {
  let opened = false
  const capabilities = {
    interruption: 'local-only',
    interruptionReuse: 'restart-required',
    historyRepair: 'restart',
    textInput: true,
    imageInput: false,
    inputRoles: ['user'],
    turnControl: 'client',
    submitCompletion: 'playback',
  }
  return {
    audio: {
      input: [{ encoding: 'pcm_s16le', sampleRate: 16000, channels: 1 }],
      output: [{ encoding: 'pcm_s16le', sampleRate: 24000, channels: 1 }],
      duplex: 'half',
      preRollMs: 80,
    },
    capabilities,
    async open(options) {
      if (opened) throw failure('device_busy')
      // Museの履歴はリモート所有。ローカル履歴を復元できたように見せない
      if (options.history.length) throw failure('unsupported_capability')
      opened = true
      let chat,
        session,
        closing,
        held = false,
        busy = false,
        stale = false,
        sent = false
      const ptt = createPushToTalk()
      const validate = (message) => {
        if (
          message?.type !== 'message' ||
          message.role !== 'user' ||
          !message.content?.length ||
          message.content.some((part) => part.type !== 'input_text' || typeof part.text !== 'string')
        )
          throw failure('unsupported_capability')
      }
      const active = () => {
        if (stale || closing) throw failure('cancelled_unconfirmed')
      }
      const stopped = () => onPlaybackState?.(false)
      try {
        chat = await openChat(options)
        const agent = createAgent(chat)
        const output = options.media.output
        session = await createConversation({
          stt,
          tts,
          voice,
          turnDetector: ptt.detector,
          agent: {
            capabilities: agent.capabilities,
            async run(request, scope) {
              if (stale || scope.signal.aborted) throw failure('cancelled_unconfirmed')
              sent = true
              const result = await agent.run(request, { signal: scope.signal })
              if (!scope.signal.aborted && result.status === 'completed') {
                for (const item of result.response.output) {
                  if (item.type === 'message')
                    options.onEvent({
                      type: 'output.text',
                      outputId: item.id,
                      delta: item.content.map((part) => part.text ?? '').join(''),
                    })
                }
              }
              return result
            },
          },
        }).open({
          ...options,
          media: {
            ...options.media,
            output: {
              ...output,
              begin(id, generation) {
                const sink = output.begin(id, generation)
                onPlaybackState?.(true)
                return sink
              },
              async finish(id) {
                try {
                  return await output.finish(id)
                } finally {
                  stopped()
                }
              },
              async fence(generation) {
                try {
                  return await output.fence(generation)
                } finally {
                  stopped()
                }
              },
            },
          },
          onEvent(event) {
            if (event.type === 'turn.started') busy = true
            if (event.type === 'input.transcript' && event.value.final && !event.value.text.trim()) busy = false
            if (event.type === 'error') {
              busy = false
              held = false
              ptt.release()
              if (sent) stale = true
              options.onEvent({ ...event, fatal: event.fatal || stale })
              return
            }
            if (event.type === 'turn.ended') {
              busy = false
              if (event.status !== 'completed' && sent && !stale) {
                stale = true
                if (!closing) options.onEvent({ type: 'error', code: 'cancelled_unconfirmed', fatal: true })
              }
              sent = false
            }
            options.onEvent(event)
          },
        })
      } catch (error) {
        chat?.close()
        opened = false
        throw error
      }
      return {
        id: session.id,
        async setInputEnabled(value) {
          active()
          if (value === held) return
          if (value) {
            if (busy) throw failure('device_busy')
            held = true
            ptt.press()
          } else {
            held = false
            busy = true
            // マイクはpipelineで止める。innerを無効化するとSTT.finishまで取り消される
            ptt.release()
          }
        },
        async submit(message, scope) {
          active()
          validate(message)
          if (busy || held) throw failure('device_busy')
          busy = true
          try {
            return await session.submit(message, scope)
          } catch (error) {
            busy = false
            throw error
          }
        },
        async interrupt() {
          stale = true
          try {
            await session.setInputEnabled(false)
            return { ...(await session.interrupt()), remote: 'unknown', history: 'restart-required' }
          } finally {
            chat.close()
            stopped()
          }
        },
        close(closeOptions) {
          if (closing) return closing
          closing = (async () => {
            try {
              return {
                ...(await session.close(closeOptions)),
                remoteFinalization: stale || sent ? 'unknown' : 'not-required',
              }
            } finally {
              chat.close()
              stopped()
              opened = false
            }
          })()
          return closing
        },
      }
    },
  }
}
