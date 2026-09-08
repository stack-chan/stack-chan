# アプリAPI

[English](./api.md)

アプリ、Blockly生成コード、既定動作は、公開SDKの `defineApp({ setup(app) {} })` を使います。[7段階の教材](../lessons/README_ja.md)から始め、[SDKガイド](../sdk/README_ja.md)で機能を増やしてください。公開型の正本は [sdk](../sdk) です。

```js
import { defineApp } from 'stackchan'

export default defineApp({
  setup(app) {
    app.input.onPress('primary', async (task) => {
      app.face.setEmotion('happy')
      await app.audio.tone(440, { durationMs: 300, signal: task.signal })
      app.ui.showBalloon('できた！')
    })
  },
})
```

| 操作 | 公開入口 |
| --- | --- |
| 表情・色・口 | `app.face` |
| 発話・素材・録音・再生 | `app.audio` |
| 首の移動・注視・脱力 | `app.motion` |
| 入力・周期処理・待機 | `app.input` / `app.time` |
| カメラ・画像・吹き出し | `app.camera` / `app.ui` |
| メニュー・図形の顔・翻訳 | `ui(app)` from `stackchan/extensions/ui` |
| 歌・音量監視・ラジオ | `singing(app)` / `streamingAudio(app)` from `stackchan/extensions/audio` |
| 通信・会話・設定・LED・センサー | `stackchan/extensions/*` |
| Piu画面 | `definePiuApp` from `stackchan/extensions/piu` |

時間は **ms**、首の角度は **度**、音量・口の開きは **0〜1** です。正のyawは左向き、正のpitchは下向きです。`motion.move` の結果で実測到達と推定完了を区別します。低レベルドライバーのラジアンをアプリへ渡しません。

非同期操作はPromiseで完了し、失敗は `StackchanError.code` で扱います。未対応は `UNSUPPORTED`、競合は `BUSY`、不正値は `INVALID_ARGUMENT`、取消しは `CANCELLED`、終了済みは `CLOSED` です。能力情報は `native / simulated / unavailable` を明示します。[操作と復帰の例](../sdk/README_ja.md)を参照してください。

AppSessionがタイマー・購読・操作・表示を所有します。イベント内では `task.sleep()` と `task.signal` を使い、非同期処理をreturnまたはawaitしてください。アプリ終了時に登録を外し、進行中の機器操作の停止を待ちます。機器を直接closeしたり、生のTimerをアプリへ追加したりする必要はありません。

host API 9から、V1 hook、旧Context、raw機器参照、`mod/config`の実行、metadataなし・schema 1・app API 1のarchiveは利用できません。[MOD定義](../../docs/specs/stackchan-mod.md)を付け、SDKのソースから再生成してください。`stackchan-mod.json.settings` には共通schemaの既定値をデータで宣言できます。保存済み設定と機種固定値が優先されます。

`npm run generate-apidoc` は現在ホスト実装を対象とする開発者向け資料です。アプリ向けAPIの入口はSDKガイドと公開型です。
