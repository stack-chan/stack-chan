# 対話プロバイダーと MCP の移行

Claude / Gemini / OpenAI の対話は `stackchan/extensions/conversation` に統合しました。旧 `ClaudeDialogue`・`GeminiDialogue`・`ChatGPTDialogue`、`post(): Maybe<string>`、直接 `fetch` するライブラリーと manifest は撤去しています。実行例は [conversation](../conversation/README_ja.md) です。このフォルダーは移行説明だけを保持します。

## 同じ対話ハンドルを使う

`defineApp` の `setup(app)` 内で使います。下記の `claudeKey`・`geminiKey`・`modelId` は利用者が選んだサービスの値を渡す箇所です。キーを公開ソースや MOD metadata に入れないでください。

```ts
import { conversation } from 'stackchan/extensions/conversation'

const chat = conversation(app)
const dialogue = chat.dialogue({
  provider: 'claude', // Gemini は 'gemini'
  apiKey: claudeKey,
  model: modelId,
  instructions: '手のひらサイズのロボット、スタックチャンです。簡潔な日本語で話します。',
  messages: [
    { role: 'user', content: '一緒にお話ししましょう' },
    { role: 'assistant', content: 'ぼくはスタックチャンだよ！お話しようね！' },
  ],
})
app.input.onPress('primary', async (task) => {
  const text = await dialogue.ask('今日は何をしよう？', { signal: task.signal })
  await app.audio.say(text, { signal: task.signal })
})
```

OpenAI は `chat.dialogue({ tools: [tool] })` で従来の SDK 例と同じです。省略時のモデルは引き続き `gpt-4o-mini`、キーは `ai.token` です。Claude / Gemini はキーとモデルを明示し、OpenAI 用のキーへ暗黙にフォールバックしません。利用可能なモデル名は各サービスで確認してください。文字起こし `transcribe` は OpenAI の別操作であり、対話の provider 指定は適用されません。

- `ask` は文字列を返し、失敗は `StackchanError` で通知します。同時要求と要求中の `clear()` は `BUSY` です。
- 入力・返答・指示は各4096文字まで。初期例は16メッセージまでで、先頭は `user`。旧 context の `system` は `instructions` へ、`user/assistant` は `messages` へ移します。
- `history` は成功した直近3往復のコピーです。失敗・取消し・不完全な返答は履歴を進めません。OpenAI は最後に成功した `previous_response_id` を、Claude / Gemini は初期例と直近3往復を次の要求に使います。
- `clear()` は履歴と OpenAI の参照IDを破棄し、初期例を維持します。`await dialogue.close()` とアプリ終了は要求を取り消し、後から来た応答の採用を止めます。
- このテキスト対話のツール実行は OpenAI で提供します。Claude / Gemini の旧参考例に無かったツール実行を暗黙に成功扱いしません。

## MCP を接続する

```ts
const remote = await chat.connectTools({ url: mcpUrl, token: mcpToken })
const dialogue = chat.dialogue({ tools: [localTool, ...remote.tools] })
// 同じ remote.tools を chat.realtime({ tools: remote.tools, ... }) にも渡せます。
```

接続は `initialize` → 初期化通知 → ツール一覧の順で準備します。複数サーバーを使う場合はそれぞれ `connectTools` で開き、配列を結合します。重複名は対話作成時に `INVALID_ARGUMENT` になるため、ローカル／サーバー側で名前を分けます。従来の名前衝突による暗黙の上書きは撤去しました。

`await remote.close()` は進行中のツール要求を取り消し、セッションIDを受け取った接続では HTTP DELETE を試みます。アプリ終了でも同じ所有者が閉じます。失敗した初期化は接続を残しません。サーバー上ですでに実行された操作の取り消しは保証しません。

対応範囲は MCP Streamable HTTP の `2025-06-18` / `2025-03-26`、JSON または終端のある SSE 応答です。HTTP は1要求30秒・応答64KiB、セッション解放は5秒、一覧は64ツール・16ページまでです。無期限の通知ストリーム・OAuth・再接続時の応答再開は対象外です。`isError`、非テキスト content、structuredContent もツール結果の JSON に保持します。HTTP / JSON-RPC の失敗を成功文字列へ変換しません。

## ビルドと互換性

`hostApiVersion: 10` と `conversation.dialogue` を宣言します。MCP 接続には `conversation.tools` も宣言します。古いホストへのインストールは書き込み前に拒否します。プロバイダー指定を古いホストに無視させないための世代更新です。

```sh
cd firmware
npm run mod:build -- mods/examples/conversation/manifest.json
```

旧参考クラスの constructor smoke は撤去し、[XS の対話・MCP寿命試験](../../../host/app/__tests__/app-conversation/app-conversation.test.js) と [TCP の MCP 結合試験](../../../host/modules/connectivity/mcp-client/__tests__/mcp-client-service/mcp-client-service.test.js) へ置き換えました。サービス認証と実機の電波・音声の受入は別に記録します。
