# リアルタイム音声対話機能統合設計書

## 概要

本文書では、ModdableのChatAudio IOをスタックチャンのdialogueモジュールに組み込み、リアルタイム音声対話機能を実現するための統合設計を提案します。

## 背景

### 現状分析

#### 既存のスタックチャン構成
- **Dialogueシステム**: 現在はテキストベースの対話（ChatGPT、Claude、Gemini）
- **TTSエンジン**: 別途音声合成を実行
- **音声入力**: マイクロフォンによる音声認識は未実装
- **非同期処理**: リクエスト/レスポンス形式でのやり取り

#### ChatAudio IOの特徴
- **リアルタイム音声処理**: ストリーミング音声入出力
- **マルチAIサービス**: OpenAI Realtime、Google Gemini Live、Hume AI EVI、Eleven Labs Agent
- **効率的なメモリ使用**: SharedArrayBufferと循環バッファ
- **Worker分離**: メインプロセスとの分離による安定性

## 統合設計

### 1. アーキテクチャ概要

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Stack-chan    │◄──►│ RealtimeDialogue │◄──►│  ChatAudioIO    │
│   Robot Core    │    │    Adapter       │    │   (Moddable)    │
└─────────────────┘    └──────────────────┘    └─────────────────┘
        ▲                        ▲                        ▲
        │                        │                        │
   ┌─────▼─────┐         ┌──────▼──────┐         ┌──────▼──────┐
   │ TTS/Mic   │         │  State Mgmt │         │ AI Workers  │
   │ Hardware  │         │  & Events   │         │ (WebSocket) │
   └───────────┘         └─────────────┘         └─────────────┘
```

### 2. 新モジュール構成

#### 2.1 RealtimeDialogue クラス
**ファイル**: `stackchan/dialogues/dialogue-realtime.ts`

```typescript
export interface RealtimeDialogueProps {
  service: 'openai' | 'gemini' | 'hume' | 'elevenlabs'
  apiKey: string
  voiceName?: string
  instructions?: string
  model?: string
}

export class RealtimeDialogue {
  #chatAudio: ChatAudioIO
  #robot: Robot
  #isActive: boolean = false
  #currentTranscript: string = ''
  
  constructor(props: RealtimeDialogueProps, robot: Robot)
  
  // 既存dialogueインターフェースとの互換性
  async post(message: string): Promise<Maybe<string>>
  clear(): void
  get history(): ChatContent[]
  
  // リアルタイム対話専用メソッド
  startRealtime(): Promise<void>
  stopRealtime(): Promise<void>
  
  // 音声レベル監視
  onInputLevelChanged(level: number): void
  onOutputLevelChanged(level: number): void
  
  // トランスクリプト処理
  onInputTranscript(text: string, more: boolean): void
  onOutputTranscript(text: string, more: boolean): void
}
```

#### 2.2 統合ファクトリー
**ファイル**: `stackchan/dialogues/dialogue-factory.ts`

```typescript
export type DialogueType = 'chatgpt' | 'claude' | 'gemini' | 'realtime'

export interface DialogueConfig {
  type: DialogueType
  realtimeService?: 'openai' | 'gemini' | 'hume' | 'elevenlabs'
  // ... 他の設定
}

export function createDialogue(config: DialogueConfig, robot?: Robot) {
  switch (config.type) {
    case 'realtime':
      return new RealtimeDialogue(config, robot)
    case 'chatgpt':
      return new ChatGPTDialogue(config)
    // ... 他のdialogue
  }
}
```

### 3. Robot クラス拡張

#### 3.1 マイクロフォン統合
**ファイル**: `stackchan/robot.ts`

```typescript
export class Robot {
  // 既存プロパティ
  #microphone?: Microphone
  #realtimeDialogue?: RealtimeDialogue
  
  // 新規メソッド
  enableRealtimeDialogue(dialogue: RealtimeDialogue): void {
    this.#realtimeDialogue = dialogue
    dialogue.startRealtime()
  }
  
  disableRealtimeDialogue(): void {
    this.#realtimeDialogue?.stopRealtime()
    this.#realtimeDialogue = undefined
  }
  
  // 音声レベル表示（表情変化）
  onInputLevelChanged(level: number): void {
    // 音声レベルに応じた表情変化
    if (level > 1000) {
      this.#faceContext.eyeOpenRatio = 1.0
    }
  }
}
```

#### 3.2 TTS統合の調整
既存のTTSシステムとリアルタイム音声を協調動作させる仕組み：

```typescript
export class Robot {
  async say(text: string, options?: SayOptions): Promise<void> {
    // リアルタイムモード時はChatAudioIOの音声出力を使用
    if (this.#realtimeDialogue?.isActive) {
      return // ChatAudioIOが音声出力を担当
    }
    
    // 通常モード時は既存TTSを使用
    return this.#tts.stream(text, options?.volume)
  }
}
```

### 4. MOD統合

#### 4.1 Realtime DialogueMOD
**ファイル**: `mods/realtime-dialogue/mod.ts`

```typescript
import { onRobotCreated } from 'on-robot-created'
import { createDialogue } from 'stackchan/dialogues/dialogue-factory'

export function onLaunch() {
  // MOD初期化
}

onRobotCreated((robot) => {
  const config = {
    type: 'realtime' as const,
    realtimeService: 'openai' as const,
    apiKey: 'your-api-key',
    voiceName: 'nova',
    instructions: 'あなたは親切で楽しいスタックチャンです。'
  }
  
  const dialogue = createDialogue(config, robot)
  robot.button.a.onChanged = function() {
    if (this.read()) {
      robot.enableRealtimeDialogue(dialogue)
    } else {
      robot.disableRealtimeDialogue()
    }
  }
})
```

### 5. 状態管理とイベント処理

#### 5.1 状態遷移
```
IDLE ──start()──► CONNECTING ──connected()──► READY
  ▲                                             │
  │                                             ▼
  └──stop()◄── STOPPING ◄──error()◄── SPEAKING/LISTENING
```

#### 5.2 イベントフロー
```typescript
// 音声入力検出 → 表情変化
ChatAudioIO.onInputLevelChanged → Robot.onInputLevelChanged → Renderer.update

// AI応答開始 → 表情変化
ChatAudioIO.onStateChanged(LISTENING) → Robot.setEmotion('happy')

// トランスクリプト → ログ出力
ChatAudioIO.onInputTranscript → trace(`User: ${text}`)
ChatAudioIO.onOutputTranscript → trace(`AI: ${text}`)
```

### 6. 設定とプリファレンス

#### 6.1 プリファレンス拡張
**ファイル**: `stackchan/preferences.ts`

```typescript
export interface RealtimeDialoguePreferences {
  enabled: boolean
  service: 'openai' | 'gemini' | 'hume' | 'elevenlabs'
  voiceName: string
  inputSensitivity: number // 0.0-1.0
  outputVolume: number // 0.0-1.0
  autoStart: boolean
}

const defaultRealtimeDialoguePrefs: RealtimeDialoguePreferences = {
  enabled: false,
  service: 'openai',
  voiceName: 'nova',
  inputSensitivity: 0.5,
  outputVolume: 0.8,
  autoStart: false
}
```

#### 6.2 HTTP API拡張
既存のHTTPサーバーにリアルタイム対話制御エンドポイントを追加：

```typescript
// GET /api/realtime/status
// POST /api/realtime/start
// POST /api/realtime/stop
// PUT /api/realtime/config
```

### 7. メモリとパフォーマンス考慮

#### 7.1 メモリ使用量
- **ChatAudioIO**: 約512KB×2（入出力バッファ）
- **Worker**: 約256KB（AIサービス処理）
- **合計追加**: 約1.3MB

#### 7.2 最適化戦略
- **条件付きロード**: リアルタイムモード時のみChatAudioIOをロード
- **バッファサイズ調整**: メモリ制約に応じたバッファサイズの動的調整
- **Worker分離**: メインプロセスの安定性確保

### 8. エラーハンドリング

#### 8.1 接続エラー
```typescript
class RealtimeDialogue {
  private handleConnectionError(error: string): void {
    trace(`Realtime dialogue connection failed: ${error}`)
    this.#robot?.setEmotion('sad')
    this.stopRealtime()
  }
}
```

#### 8.2 音声エラー
- **マイク未接続**: フォールバック（既存dialogue使用）
- **スピーカー未接続**: 表情のみでの応答
- **ネットワーク不安定**: 自動再接続とバッファリング

### 9. テスト戦略

#### 9.1 単体テスト
- **RealtimeDialogue**: モックChatAudioIOでの状態遷移テスト
- **音声レベル処理**: 音声信号生成とレベル計算の検証
- **エラーハンドリング**: 各種エラーケースの動作確認

#### 9.2 統合テスト
- **Hardware-in-the-loop**: 実機でのリアルタイム対話テスト
- **長時間テスト**: メモリリークと安定性の検証
- **複数AIサービス**: 各AIサービスの互換性テスト

### 10. 実装フェーズ

#### Phase 1: 基盤構築
1. RealtimeDialogue基本クラス実装
2. Robot統合インターフェース
3. 基本的な状態管理

#### Phase 2: 機能拡張
1. 複数AIサービス対応
2. プリファレンス システム
3. HTTP API拡張

#### Phase 3: 最適化
1. メモリ使用量最適化
2. パフォーマンステスト
3. エラーハンドリング強化

## 想定される課題と解決策

### 課題1: 既存TTSとの競合
**解決策**: Robot.sayメソッドでの条件分岐により協調動作

### 課題2: メモリ制約
**解決策**: 条件付きロードと動的バッファサイズ調整

### 課題3: 音声入力品質
**解決策**: ハードウェアレベルでのノイズ除去とソフトウェアフィルタリング

### 課題4: レイテンシ
**解決策**: ストリーミング処理と予測的バッファリング

## 結論

本設計により、スタックチャンにリアルタイム音声対話機能を統合できます。既存のアーキテクチャとの互換性を保ちながら、新しいインタラクション体験を提供できる設計となっています。

実装前に以下の確認をお願いします：
1. 対象ハードウェアのメモリ制約
2. 使用するAIサービスの選択
3. 既存MODとの競合の有無
4. ユーザーインターフェースの要件