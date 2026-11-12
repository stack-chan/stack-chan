export type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json }
export type Schema = Readonly<Record<string, Json>>
export interface VoiceSignal {
  readonly aborted: boolean
  readonly reason?: unknown
  addEventListener(type: 'abort', listener: () => void): void
  removeEventListener(type: 'abort', listener: () => void): void
}
export type Scope = { readonly signal: VoiceSignal }

export type Image =
  | { readonly format: 'jpeg' | 'png'; readonly data: Uint8Array }
  | {
      readonly format: 'rgb565le' | 'rgb565be'
      readonly width: number
      readonly height: number
      readonly data: Uint8Array
    }

export type InputContent =
  | { readonly type: 'input_text'; readonly text: string }
  | { readonly type: 'input_image'; readonly image: Image; readonly detail?: 'auto' | 'low' | 'high' }
  | { readonly type: 'input_image'; readonly image_url: string; readonly detail?: 'auto' | 'low' | 'high' }

export type InputMessage = {
  readonly type: 'message'
  readonly role: 'user' | 'system' | 'developer'
  readonly content: readonly InputContent[]
}
export type OutputMessage = {
  readonly type: 'message'
  readonly id: string
  readonly role: 'assistant'
  readonly phase?: 'commentary' | 'final_answer' | null
  readonly content: readonly (
    | { readonly type: 'output_text'; readonly text: string }
    | { readonly type: 'refusal'; readonly refusal: string }
  )[]
}
export type FunctionCall = {
  readonly type: 'function_call'
  readonly id: string
  readonly call_id: string
  readonly name: string
  readonly arguments: string
}
export type FunctionOutput = {
  readonly type: 'function_call_output'
  readonly call_id: string
  readonly output: string
}
export type ProviderItem = {
  readonly type: 'provider_item'
  readonly id: string
  readonly provider: string
  readonly value: unknown
}
export type InputItem = InputMessage | OutputMessage | FunctionCall | FunctionOutput | ProviderItem
export type OutputItem = OutputMessage | FunctionCall | ProviderItem
export type FunctionDefinition = {
  readonly type: 'function'
  readonly name: string
  readonly description: string
  readonly parameters: Schema
  readonly strict?: boolean
}
export type ResponseRequest = {
  readonly instructions?: string
  readonly input: readonly InputItem[]
  readonly tools?: readonly FunctionDefinition[]
  readonly tool_choice?: 'auto' | 'none' | 'required'
  readonly max_output_tokens?: number
}
export type ResponseEvent =
  | {
      readonly type: 'response.output_text.delta'
      readonly item_id: string
      readonly delta: string
      readonly phase?: OutputMessage['phase']
    }
  | { readonly type: 'response.function_call_arguments.delta'; readonly item_id: string; readonly delta: string }
export type ModelResponse = {
  readonly id: string
  readonly status: 'completed' | 'incomplete'
  readonly output: readonly OutputItem[]
  readonly usage?: { readonly input_tokens: number; readonly output_tokens: number }
}
export interface LLM {
  readonly capabilities: { readonly image: boolean; readonly tools: boolean }
  createResponse(
    request: ResponseRequest,
    options: Scope & {
      readonly onEvent?: (event: ResponseEvent) => void | Promise<void>
    },
  ): Promise<ModelResponse>
}

export type ToolContext = Scope & {
  readonly sessionId: string
  readonly turnId: string
  readonly callId: string
}
export interface ToolSet {
  readonly definitions: readonly FunctionDefinition[]
  execute(call: FunctionCall, context: ToolContext): Promise<FunctionOutput>
}
export type Failure = {
  readonly code:
    | 'unsupported_capability'
    | 'device_busy'
    | 'cancelled'
    | 'deadline_exceeded'
    | 'input_overrun'
    | 'provider_failed'
    | 'resource_exhausted'
    | 'tool_failed'
  readonly message: string
}
export type AgentResult =
  | {
      readonly status: 'completed' | 'incomplete'
      readonly response: ModelResponse
      readonly appended: readonly InputItem[]
    }
  | { readonly status: 'cancelled' | 'failed'; readonly error: Failure; readonly appended: readonly InputItem[] }
export interface Agent {
  run(
    request: {
      readonly input: readonly InputItem[]
      readonly sessionId: string
      readonly turnId: string
    },
    options: Scope & {
      readonly onEvent?: (event: ResponseEvent) => void | Promise<void>
    },
  ): Promise<AgentResult>
}
export type AgentOptions = {
  readonly llm: LLM
  readonly tools: ToolSet
  readonly instructions: string
  readonly maxToolRounds: number
}

export type PcmFormat = {
  readonly encoding: 'pcm_s16le'
  readonly sampleRate: number
  readonly channels: 1 | 2
}
export type MediaBudget = {
  readonly maxBufferedMs: number
  readonly maxBufferedBytes: number
}
declare const audioSourceBrand: unique symbol
declare const audioSinkBrand: unique symbol
export interface AudioSource {
  readonly [audioSourceBrand]: true
  readonly format: PcmFormat
}
export interface AudioSink {
  readonly [audioSinkBrand]: true
  readonly format: PcmFormat
}
export type PlaybackCursor =
  | { readonly basis: 'device-clock' | 'estimate'; readonly renderedFrames: number; readonly sampleRate: number }
  | { readonly basis: 'unknown' }
export type PlaybackReceipt = {
  readonly outputId: string
  readonly generation: number
  readonly position: PlaybackCursor
  readonly state: 'played' | 'interrupted' | 'failed'
}
export interface PlaybackSink extends AudioSink {
  readonly budget: MediaBudget
  begin(outputId: string, generation: number): AudioSink
  finish(outputId: string): Promise<PlaybackReceipt>
  fence(nextGeneration: number): Promise<readonly PlaybackReceipt[]>
}
export interface MediaLink {
  readonly done: Promise<void>
  close(): Promise<void>
}
export interface MediaRuntime {
  connect(
    source: AudioSource,
    sink: AudioSink,
    options: Scope & {
      readonly budget: MediaBudget
      readonly replayMs?: number
    },
  ): Promise<MediaLink>
}
export type AudioRequirements = {
  readonly preRollMs?: number
  readonly nativeBackend?: string
  readonly input: readonly PcmFormat[]
  readonly output: readonly PcmFormat[]
  readonly duplex: 'half' | 'full'
}
export type PlaybackOptions = Scope & { readonly budget: MediaBudget; readonly onPlayed?: (power: number) => void }
export interface PlaybackLease {
  readonly output: PlaybackSink
  readonly media: MediaRuntime
  setVolume(gain: number): void
  close(): Promise<void>
}
export interface DuplexLease extends PlaybackLease {
  readonly input: AudioSource
  setInputEnabled(enabled: boolean): Promise<void>
}
export interface AudioRuntime {
  acquirePlayback(speaker: Speaker, formats: readonly PcmFormat[], options: PlaybackOptions): Promise<PlaybackLease>
  acquire(
    microphone: Microphone,
    speaker: Speaker,
    requirements: AudioRequirements,
    options: Scope & { readonly budget: MediaBudget },
  ): Promise<DuplexLease>
}
export interface Microphone {
  readonly id: string
  readonly runtime: AudioRuntime
}
export interface Speaker {
  readonly id: string
  readonly runtime: AudioRuntime
}

export type Transcript = {
  readonly utteranceId: string
  /** 同じ発話の全文更新。途中結果は連結せず、前の内容を置き換える */
  readonly text: string
  /** 音声入力を確定した後の最終結果だけがtrue。同じ発話では一度だけ通知する */
  readonly final: boolean
}
export interface Transcription {
  readonly input: AudioSink
  finish(): Promise<void>
  close(): Promise<void>
}
export interface STT {
  open(
    options: Scope & {
      readonly utteranceId: string
      readonly format: PcmFormat
      readonly onTranscript: (value: Transcript) => void
    },
  ): Promise<Transcription>
}
export interface Synthesis {
  readonly output: AudioSource
  /** 入力操作は完了を待って順に呼ぶ。音声はfinish前にも出力され得る */
  write(text: string): Promise<void>
  /** ここまでの入力のPCMを出力へ渡し終えるまで待ち、入力と出力を開いたままにする。再生完了は含まない */
  flush(): Promise<void>
  /** 入力を閉じ、残りの合成と音声出力の終了を待つ。再生完了は含まない */
  finish(): Promise<void>
  close(): Promise<void>
}
export interface TTS {
  open(options: Scope & { readonly voice: string; readonly format: PcmFormat }): Promise<Synthesis>
}
export type TurnSignal =
  | { readonly type: 'speech-start'; readonly utteranceId: string }
  | { readonly type: 'speech-end'; readonly utteranceId: string }
  | { readonly type: 'turn-ready'; readonly utteranceId: string }
export interface TurnDetector {
  readonly preRollMs?: number
  start(
    options: Scope & {
      readonly audio: AudioSource
      readonly nextUtteranceId: () => string
      readonly onSignal: (signal: TurnSignal) => void
    },
  ): Promise<{ readonly close: () => Promise<void>; readonly updateTranscript: (value: Transcript) => void }>
}

export type ConversationCapabilities = {
  readonly interruption: 'remote-cancel' | 'local-only'
  readonly historyRepair: 'truncate' | 'annotate' | 'restart'
  readonly textInput: boolean
  readonly imageInput: boolean
}
export type ConversationEvent =
  | { readonly type: 'input.transcript'; readonly value: Transcript }
  | { readonly type: 'output.text'; readonly outputId: string; readonly delta: string }
  | { readonly type: 'output.playback'; readonly receipt: PlaybackReceipt }
  | { readonly type: 'turn.started'; readonly turnId: string }
  | { readonly type: 'turn.ended'; readonly turnId: string; readonly status: 'completed' | 'interrupted' | 'failed' }
  | { readonly type: 'error'; readonly code: string; readonly fatal: boolean }
export type Interruption = {
  readonly playback: readonly PlaybackReceipt[]
  readonly remote: 'cancelled' | 'continued' | 'unknown'
  readonly history: 'aligned' | 'conservative' | 'annotated' | 'restart-required'
}
export type CloseOptions = { readonly mode: 'drain' | 'abort'; readonly timeoutMs?: number }
export type CloseResult = {
  readonly reason: 'drained' | 'aborted' | 'drain-timeout'
  readonly remoteFinalization: 'confirmed' | 'unknown' | 'not-required'
}
export interface ConversationSession {
  readonly id: string
  submit(message: InputMessage, scope: Scope): Promise<void>
  setInputEnabled(enabled: boolean): Promise<void>
  interrupt(): Promise<Interruption>
  close(options: CloseOptions): Promise<CloseResult>
}
export interface Conversation {
  readonly capabilities: ConversationCapabilities
  readonly audio: AudioRequirements
  open(
    options: Scope & {
      readonly media: Pick<DuplexLease, 'input' | 'output' | 'media'>
      readonly history: readonly InputItem[]
      readonly onEvent: (event: ConversationEvent) => void
    },
  ): Promise<ConversationSession>
}
export type CascadedOptions = {
  readonly stt: STT
  readonly agent: Agent
  readonly tts: TTS
  readonly turnDetector: TurnDetector
  readonly voice: string
}
export type Delegation =
  | { readonly kind: 'none' }
  | { readonly kind: 'hosted'; readonly model: string; readonly instructions?: string; readonly tools?: ToolSet }
  | { readonly kind: 'client'; readonly delegate: DelegateAgent }
export interface DelegateAgent {
  run(
    request: {
      readonly sessionId: string
      readonly turnId: string
      readonly delegationId: string
      readonly input: readonly InputItem[]
    },
    options: Scope,
  ): Promise<readonly InputItem[]>
}
export type PipelineOptions = {
  readonly microphone: Microphone
  readonly speaker: Speaker
  readonly conversation: Conversation
  readonly mediaBudget: MediaBudget
  readonly history?: readonly InputItem[]
  readonly onEvent?: (event: ConversationEvent) => void
}
export interface ConversationPipeline {
  start(scope?: Scope): Promise<void>
  submit(message: InputMessage, scope?: Scope): Promise<void>
  setMuted(muted: boolean): Promise<void>
  setVolume(gain: number): void
  interrupt(): Promise<Interruption>
  close(options?: CloseOptions): Promise<CloseResult>
}

export interface CapturedImage {
  readonly image: Image
  readonly capturedAtMs: number
  release(): void
}
export interface Camera {
  capture(options: Scope & { readonly width: number; readonly height: number }): Promise<CapturedImage>
}
export interface Vision {
  observe(
    request: { readonly question: string },
    scope: Scope,
  ): Promise<{
    readonly text: string
    readonly capturedAtMs: number
  }>
}
export type VisionOptions = { readonly camera: Camera; readonly llm: LLM }
