# ChatGPT Dialogue Tool Call Enhancement Tasks

## 現在の実装状況

### 実装済み機能
- [x] 基本的なツール統合（ローカルツール + MCPクライアント）
- [x] 単一ツール呼び出し + 1回のメッセージ応答フロー
- [x] ツール実行エラーハンドリング
- [x] OpenAI Responses API対応
- [x] 簡潔な線形フロー実装

### 現在の制限事項
- **ツール呼び出し回数制限**: 1回のツール呼び出し + 1回のメッセージ応答のみ対応
- **並列処理なし**: 複数ツールの並列実行未対応
- **ネストツール呼び出し未対応**: 連続したツール呼び出しに未対応
- **イベントシステム未実装**: ツール呼び出し時のイベント発火機能なし

## 残件・要望機能

### 1. 複数回のツール呼び出し対応 ✅ **完了**
- [x] **ネストツール呼び出し対応**
  - ✅ 実装完了: `#executeConversationFlow`メソッドによる反復処理
  - ✅ AIが複数回連続してツールを呼び出せるフロー実装
  - ✅ while文ベースのループ処理で連続ツール呼び出しに対応

- [x] **ツール呼び出し深度制限**
  - ✅ 実装完了: `maxIterations = 10`で無限ループ防止
  - ✅ 設定可能な深度上限（現在: 10回）
  - ✅ 反復回数追跡とトレースログ出力

### 2. 並列ツール呼び出し対応 ✅ **完了**
- [x] **同時複数ツール実行**
  - ✅ 実装完了: `#executeMultipleToolsParallel`メソッドによる並列実行
  - ✅ `Promise.allSettled()`を使用した並列実行
  - ✅ 各ツールの実行結果を統合してAIに返す機能

- [x] **並列実行結果の統合**
  - ✅ 実装完了: 複数ツールの結果をまとめる仕組み
  - ✅ 実行順序の管理とエラーハンドリング
  - ✅ 一部ツール失敗時も継続実行する処理方針

### 3. イベントシステム実装 ✅ **完了**
- [x] **ツール呼び出しイベント**
  - ✅ 実装完了: `onToolCallStarted(toolName, input)`: ツール実行開始時
  - ✅ 実装完了: `onToolCallCompleted(toolName, result)`: ツール実行完了時
  - ✅ 実装完了: `onToolCallFailed(toolName, error)`: ツール実行失敗時

- [x] **イベントハンドラー登録機能**
  - ✅ 実装完了: ChatGPTDialogueクラスにイベントリスナー登録メソッド追加
  - ✅ 実装完了: 型安全なイベントハンドラー定義

### 4. フロー制御の改善
- [ ] **状態管理の再設計**
  - 現在の線形フローを拡張して複雑なフローに対応
  - ツール呼び出し履歴の管理
  - 実行コンテキストの保持

- [ ] **タイムアウト処理**
  - ツール実行のタイムアウト設定
  - 長時間実行の中断機能

### 5. パフォーマンス向上
- [ ] **キャッシュ機能**
  - 同一パラメータでのツール実行結果キャッシュ
  - MCP ツール一覧のキャッシュ最適化

- [ ] **実行統計**
  - ツール呼び出し回数・実行時間の測定
  - パフォーマンスメトリクス収集

## 実装優先度

### 高優先度
1. **複数回ツール呼び出し対応** - AIとの自然な対話に必要
2. **イベントシステム** - デバッグとモニタリングに重要

### 中優先度  
3. **並列ツール実行** - パフォーマンス向上
4. **フロー制御改善** - 複雑なワークフロー対応

### 低優先度
5. **キャッシュ・統計機能** - 最適化とモニタリング

## 技術的考慮事項

### ツール呼び出しフロー設計案
```typescript
// 現在: 線形フロー
User Message → AI Response → [Tool Call] → Tool Result → AI Final Response

// 目標: 拡張フロー  
User Message → AI Response → [Tool Call(s)] → Tool Result(s) → AI Response → [Tool Call(s)] → ... → Final Response
```

### イベントシステム設計案
```typescript
interface ToolCallEvent {
  toolName: string
  input: Record<string, unknown>
  timestamp: number
}

interface ToolCallEventHandlers {
  onToolCallStarted?: (event: ToolCallEvent) => void
  onToolCallCompleted?: (event: ToolCallEvent & { result: string }) => void
  onToolCallFailed?: (event: ToolCallEvent & { error: Error }) => void
}
```

### 並列実行設計案
```typescript
// 複数ツール呼び出しの並列実行
const toolCalls = extractMultipleToolCalls(response)
const results = await Promise.all(
  toolCalls.map(call => this.#executeIntegratedTool(call.name, call.input))
)
```

## 実装履歴

### 2025-01-11: タスク1完了 - 複数回ツール呼び出し対応

**実装内容:**
- `#executeConversationFlow()`メソッド追加
- 最大10回の反復処理でネストツール呼び出し対応
- ツール実行結果を次の反復に渡すフロー
- エラーハンドリングと反復回数追跡
- `#trimHistory()`メソッドでメモリ管理改善

**技術詳細:**
```typescript
// 新しいフロー
User Message → AI Response → Tool Call → Tool Result → AI Response → Tool Call → ... → Final Response

// 実装キーポイント
while (iterationCount < maxIterations) {
  const response = await this.#sendMessage(currentMessage, allTools)
  if (isToolCall(response)) {
    const toolResult = await this.#executeIntegratedTool(response.name, response.input)
    currentMessage = createToolResultMessage(toolResult)
    iterationCount++
    continue
  }
  // ... handle chat content
}
```

### 2025-01-11: タスク2完了 - 並列ツール呼び出し対応

**実装内容:**
- `#executeMultipleToolsParallel()`メソッド追加
- `Promise.allSettled()`による並列ツール実行
- 複数ツール呼び出し検出機能（`isMultipleToolCalls()`）
- 並列実行結果の統合とエラーハンドリング
- OpenAI Responses API複数ツール対応

**技術詳細:**
```typescript
// 並列実行フロー
Multiple Tool Calls → Promise.allSettled([tool1, tool2, ...]) → Combined Result → AI Response

// 実装キーポイント
async #executeMultipleToolsParallel(toolCalls: ToolCall[]): Promise<string> {
  const results = await Promise.allSettled(
    toolCalls.map(call => this.#executeIntegratedTool(call.name, call.input))
  )
  return combineResults(results) // 成功・失敗両方を含む統合結果
}
```

### 2025-01-11: タスク3完了 - イベントシステム実装

**実装内容:**
- ツール呼び出しイベント型定義（`ToolCallEvent`, `ToolCallEventHandlers`）
- イベント発火メソッド群（`#fireToolCallStarted`, `#fireToolCallCompleted`, `#fireToolCallFailed`）
- イベントハンドラー登録機能（`setEventHandlers`, `addEventListener`, `removeEventListener`）
- 単一・並列ツール実行でのイベント統合
- タイムスタンプ付きイベントデータ

**技術詳細:**
```typescript
// イベントシステム構造
interface ToolCallEvent {
  toolName: string
  input: Record<string, unknown>
  timestamp: number
}

interface ToolCallEventHandlers {
  onToolCallStarted?: (event: ToolCallEvent) => void
  onToolCallCompleted?: (event: ToolCallEvent & { result: string }) => void
  onToolCallFailed?: (event: ToolCallEvent & { error: Error }) => void
}

// 使用例
const dialogue = new ChatGPTDialogue({
  apiKey: 'your-api-key',
  eventHandlers: {
    onToolCallStarted: (event) => trace(`Tool ${event.toolName} started\n`),
    onToolCallCompleted: (event) => trace(`Tool ${event.toolName} completed: ${event.result}\n`),
    onToolCallFailed: (event) => trace(`Tool ${event.toolName} failed: ${event.error.message}\n`)
  }
})
```

---

**作成日**: 2025-01-11  
**最終更新**: 2025-01-11  
**ステータス**: タスク1-3全完了
