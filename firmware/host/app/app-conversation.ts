import { AppConnection, type AppServiceScope } from 'app-service-scope'
import type { RemoteConversationSession } from 'capabilities'
import Modules from 'modules'
import type { StackchanRuntimeAudio } from 'runtime-audio'
import { StackchanError } from 'stackchan/errors'
import type { AppConversation, ChatState } from 'stackchan/extensions/conversation'
import type { AppSettings } from 'stackchan/extensions/settings'
import type { CancellationSignal, TaskContext } from 'stackchan/task'

type Request = (
  request: { url: string; method: 'POST'; headers: Record<string, string>; body: string | readonly ArrayBuffer[] },
  signal?: CancellationSignal,
) => Promise<{ status: number; body: string }>

export function createAppConversation(
  scope: AppServiceScope,
  settings: AppSettings,
  audio: Pick<StackchanRuntimeAudio, 'reserveStream' | 'failStream'>,
  remote?: RemoteConversationSession,
  transport?: Request,
): AppConversation {
  const http: Request = (request, signal) => {
    if (transport) return transport(request, signal)
    if (!Modules.has('app-http'))
      throw new StackchanError('UNSUPPORTED', 'Cloud conversation is unavailable on this target')
    return (Modules.importNow('app-http') as Request)(request, signal)
  }
  const key = (value?: string) => {
    const token = value || settings.get('ai.token')
    if (!token) throw new StackchanError('CONFIG', 'Set ai.token in Settings before starting cloud conversation')
    return token
  }
  const post = async (
    path: string,
    body: string | readonly ArrayBuffer[],
    token: string,
    task: TaskContext,
    contentType = 'application/json',
  ) => {
    const response = await http(
      {
        url: `https://api.openai.com/v1/${path}`,
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': contentType },
        body,
      },
      task.signal,
    )
    task.signal.throwIfCancelled()
    if (response.status < 200 || response.status >= 300)
      throw new StackchanError('IO', `Conversation request failed (HTTP ${response.status})`)
    try {
      return JSON.parse(response.body)
    } catch {
      throw new StackchanError('IO', 'Conversation returned invalid JSON')
    }
  }
  return {
    dialogue: (options = {}) =>
      scope.call(() => {
        const token = key(options.apiKey),
          owner = new AppConnection(scope)
        let previous: string | undefined,
          busy = false
        return {
          close: owner.close,
          clear: () =>
            owner.call(() => {
              if (busy) throw new StackchanError('BUSY', 'Wait for the dialogue request before clearing it')
              previous = undefined
            }),
          ask: (text, request) =>
            owner.run(async (task) => {
              if (busy) throw new StackchanError('BUSY', 'Dialogue is already answering')
              if (typeof text !== 'string' || !text.trim() || text.length > 4096)
                throw new StackchanError('INVALID_ARGUMENT', 'Dialogue text must contain 1–4096 characters')
              busy = true
              try {
                let input: Record<string, unknown>[] = [{ role: 'user', content: text }]
                let answer = ''
                for (let iteration = 0; iteration < 10; iteration++) {
                  task.signal.throwIfCancelled()
                  const response = await post(
                    'responses',
                    JSON.stringify({
                      model: options.model ?? 'gpt-4o-mini',
                      instructions:
                        options.instructions ??
                        settings.get('ai.context') ??
                        'You are Stack-chan, a friendly palm-sized robot. Reply briefly in the language of the user.',
                      previous_response_id: previous,
                      input,
                      tools: options.tools?.map((tool) => ({
                        type: 'function',
                        name: tool.name,
                        description: tool.description,
                        parameters: tool.inputSchema,
                      })),
                    }),
                    token,
                    task,
                  )
                  if (!Array.isArray(response.output) || typeof response.id !== 'string')
                    throw new StackchanError('IO', 'Conversation response has no output')
                  previous = response.id
                  input = []
                  for (const output of response.output) {
                    if (output.type === 'message' && Array.isArray(output.content)) {
                      for (const content of output.content) {
                        const text =
                          content.type === 'output_text'
                            ? content.text
                            : content.type === 'refusal'
                              ? content.refusal
                              : ''
                        if (typeof text === 'string' && text) answer += (answer ? '\n' : '') + text
                        if (answer.length > 4096)
                          throw new StackchanError('IO', 'Conversation answer exceeds the speech limit')
                      }
                    } else if (output.type === 'function_call') {
                      task.signal.throwIfCancelled()
                      const tool = options.tools?.find((tool) => tool.name === output.name)
                      let result: string
                      try {
                        result = tool
                          ? await tool.execute(JSON.parse(output.arguments), task)
                          : `Unknown tool: ${output.name}`
                      } catch (error) {
                        task.signal.throwIfCancelled()
                        result = error instanceof Error ? error.message : 'Tool failed'
                      }
                      input.push({ type: 'function_call_output', call_id: output.call_id, output: result })
                    }
                  }
                  if (!input.length) return answer
                }
                throw new StackchanError('IO', 'Conversation exceeded 10 tool iterations')
              } finally {
                busy = false
              }
            }, request?.signal),
        }
      }),
    transcribe: (recording, options = {}) =>
      scope.run(async (task) => {
        if (!(recording?.data instanceof ArrayBuffer) || !/^[a-zA-Z0-9_.-]{1,128}$/.test(recording.filename))
          throw new StackchanError('INVALID_ARGUMENT', 'A recorded audio value is required')
        const boundary = `stackchan-${Date.now().toString(16)}`
        const language = options.language ?? 'ja'
        if (!/^[a-z]{2,3}$/.test(language))
          throw new StackchanError('INVALID_ARGUMENT', 'Use a language code such as ja or en')
        const header = `--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-1\r\n--${boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\n${language}\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${recording.filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`
        const response = await post(
          'audio/transcriptions',
          [ArrayBuffer.fromString(header), recording.data, ArrayBuffer.fromString(`\r\n--${boundary}--\r\n`)],
          key(options.apiKey),
          task,
          `multipart/form-data; boundary=${boundary}`,
        )
        if (typeof response.text !== 'string') throw new StackchanError('IO', 'Transcription has no text')
        return response.text
      }, options.signal),
    realtime: (options) =>
      scope.run(async () => {
        if (!Modules.has('chat'))
          throw new StackchanError('UNSUPPORTED', 'Realtime audio is unavailable on this target')
        const owner = new AppConnection(scope)
        try {
          const release = audio.reserveStream(true, true)
          owner.own(release)
          const { ChatService, chatStateToName } = Modules.importNow('chat') as {
            chatStateToName(state: number): string
            ChatService: new (
              options: object,
            ) => {
              setVolume(volume: number): void
              start(): void
              close(): void
              sendFunctionResult(call: string, name: string, result: string): void
            }
          }
          const tools = Object.fromEntries(
            (options.tools ?? []).map((tool) => [tool.name, { ...tool, parameters: tool.inputSchema }]),
          )
          const chat = new ChatService({
            config: {
              type: options.provider ?? settings.get('chat.type'),
              apiKey: options.apiKey ?? (settings.get('chat.apiKey') || settings.get('ai.token')),
              endpoint: options.endpoint ?? settings.get('chat.endpoint'),
              modelID: options.model ?? settings.get('chat.modelID'),
              voiceID: options.voice ?? settings.get('chat.voiceID'),
              instructions: options.instructions ?? settings.get('chat.instructions'),
            },
            tools,
            callbacks: {
              onStateChanged: owner.event((state: number, error?: string) => {
                const name = chatStateToName(state).toLowerCase() as ChatState
                options.onState?.(name, error)
                if (name === 'failed' || name === 'disconnected') void owner.close().catch(scope.report)
              }),
              onOutputTranscript: owner.event(options.onTranscript),
              onOutputLevelChanged: owner.event((level: number) =>
                options.onOutputLevel?.(Math.max(0, Math.min(1, level / 2000))),
              ),
              onFunctionCall: owner.event((call: string, name: string, params: Record<string, unknown>) => {
                void owner
                  .run(async (task) => {
                    const tool = options.tools?.find((tool) => tool.name === name)
                    let result: string
                    try {
                      result = tool ? await tool.execute(params, task) : `Unknown tool: ${name}`
                    } catch (error) {
                      task.signal.throwIfCancelled()
                      result = String(error)
                    }
                    owner.call(() => chat.sendFunctionResult(call, name, result))
                  })
                  .catch(scope.report)
              }),
            },
          })
          owner.own(() => {
            try {
              chat.close()
            } catch (error) {
              audio.failStream(error)
              throw error
            }
          })
          chat.setVolume(options.volume ?? 0.5)
          chat.start()
          return owner
        } catch (error) {
          await owner.close()
          throw error
        }
      }),
    remote: () =>
      scope.call(() => {
        if (!remote) throw new StackchanError('UNSUPPORTED', 'USB remote conversation is unavailable on this target')
        const owner = new AppConnection(scope)
        try {
          owner.own(audio.reserveStream(true, true))
          remote.activate()
          owner.own(() => remote.deactivate())
          return {
            close: owner.close,
            get state() {
              return remote.state
            },
            get transport() {
              return remote.transportState
            },
            get lastError() {
              return remote.lastError
            },
            requestStart: () => owner.call(() => remote.requestStart()),
            requestStop: () => owner.call(() => remote.requestStop()),
            onState: (handler) => owner.listen((receive) => remote.subscribe(receive), handler),
            onTransport: (handler) => owner.listen((receive) => remote.subscribeTransport(receive), handler),
          }
        } catch (error) {
          void owner.close().catch(scope.report)
          throw error
        }
      }),
  }
}
