import { type ConversationPost, createDialogue } from 'app-dialogue'
import { AppConnection, type AppServiceScope } from 'app-service-scope'
import type { AudioStreamAccess } from 'audio-ports'
import type { RemoteConversationSession } from 'capabilities'
import { createMCPClient } from 'mcp-client'
import Modules from 'modules'
import { StackchanError } from 'stackchan/errors'
import type { AppConversation, ChatState } from 'stackchan/extensions/conversation'
import type { HttpRequest, HttpResponse } from 'stackchan/extensions/network'
import type { AppSettings } from 'stackchan/extensions/settings'
import type { CancellationSignal } from 'stackchan/task'

type Request = (
  request: Omit<HttpRequest, 'body'> & { body?: string | readonly ArrayBuffer[] },
  signal?: CancellationSignal,
) => Promise<HttpResponse>

export function createAppConversation(
  scope: AppServiceScope,
  settings: AppSettings,
  audio: AudioStreamAccess,
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
  const post: ConversationPost = async (url, body, headers, task) => {
    const response = await http(
      { url, method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body },
      task.signal,
    )
    task.signal.throwIfCancelled()
    if (response.status < 200 || response.status >= 300)
      throw new StackchanError('IO', `Conversation request failed (HTTP ${response.status})`)
    try {
      const value: unknown = JSON.parse(response.body)
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object')
      return value as Record<string, unknown>
    } catch {
      throw new StackchanError('IO', 'Conversation returned invalid JSON')
    }
  }
  return {
    dialogue: (options = {}) =>
      scope.call(() => {
        if (!options || typeof options !== 'object' || Array.isArray(options))
          throw new StackchanError('INVALID_ARGUMENT', 'Dialogue options must be an object')
        return createDialogue(
          scope,
          options,
          {
            apiKey: options.provider && options.provider !== 'openai' ? '' : key(options.apiKey),
            instructions:
              settings.get('ai.context') ||
              'You are Stack-chan, a friendly palm-sized robot. Reply briefly in the language of the user.',
          },
          post,
        )
      }),
    connectTools: (options, operation) =>
      scope.run(async (task) => {
        const owner = new AppConnection(scope)
        try {
          const client = createMCPClient(options, http)
          owner.own(() => client.close())
          const schemas = await owner.run((task) => client.connect(task.signal), task.signal)
          return {
            close: owner.close,
            tools: schemas.map((tool) => ({
              ...tool,
              execute: (input, task) => owner.run((task) => client.call(tool.name, input, task.signal), task.signal),
            })),
          }
        } catch (error) {
          await owner.close()
          throw error
        }
      }, operation?.signal),
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
          'https://api.openai.com/v1/audio/transcriptions',
          [ArrayBuffer.fromString(header), recording.data, ArrayBuffer.fromString(`\r\n--${boundary}--\r\n`)],
          {
            Authorization: `Bearer ${key(options.apiKey)}`,
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
          },
          task,
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
          if (remote.activationState === 'active') throw new StackchanError('BUSY', 'Remote conversation is active')
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
