# OpenAI WebRTC 開始失敗の診断

## 調査結果と対象

2026-10-31 の「会話エラー。もう一度開始してください」の実機原因は未確定です。当日の書込み済みホスト／MODのコミット、manifest、バイナリ識別値、エラーログを取得できていません。現在の develop のコードが実機で動いていたとは扱いません。

今回確認したソースの基点は develop `e7e27e2f8b89b53d535717b186e88b10911fa746`。関連する [#757](https://github.com/stack-chan/stack-chan/pull/757) は調査時点で未マージ、head は `88dd0612de3715d7ac64da41b619327d529e1c17` です。標準 CoreS3 配布物にこのPRが入っていると推定しないでください。この修正は develop 向けで、#757 の構成変更は取り込みません。

調べた実装:

- `firmware/mods/examples/openai_live_webrtc/mod.js`: ホスト機能確認とUI。
- 同 `session.js`: 設定、ネットワーク待ち、ホスト音声／radio所有権、アンプ設定、Conversation生成・接続・終了。
- `firmware/host/modules/realtime-conversation/core.js`: 認証付きセッション作成、SDP交換、イベント処理、タイムアウト、hangup。
- 同 `http-core.js` / `http-queue.js` / `http-proxy.js`: SDK HTTPS、Worker転送、期限・容量制限。
- 同 `esp32/transport.c` / `liveAudio.c`: ネイティブ資源、Opus／I2S、音声タスク、WebRTC、終了待ち。

今回の環境には USB シリアル機器、接続可能な実機、NucBox/X1 の接続設定がありません。書込み・実API要求・マイク送信・再現試験は実施していません。APIキーの取得や更新も行っていません。

## 失敗経路

| ログの phase / stage | 意味・確認する対象 |
| --- | --- |
| `host_preflight` | `conversation` / `audio` / `amplifier` / `radio` の有無。欠ける場合は `host_unsupported`。 |
| `host_import` | Conversation または network-power のロード失敗。旧ホストではこの時点でHTTPS Workerが生成され、メモリ不足等で失敗する可能性がある。 |
| `configuration` | MODのAPIキーが空、または文字列ではない。キー自体や長さは記録しない。 |
| `network_ready` | Wi-Fi ready の拒否、または接続済み以外の結果。 |
| `audio_acquire` | TTS／録音等との音声排他の取得失敗。 |
| `radio_acquire` | Wi-Fi低遅延利用権の取得失敗。取得済み音声は解放する。 |
| `amp_configure` | 48 kHzへのアンプ設定失敗。 |
| `conversation_create` / `volume_configure` | Conversation設定の検証、音量設定等の失敗。 |
| `transport_create` / `transport_start`, `transport` | `transport_create_failed` はネイティブ所有権／構築、`transport_start_failed` はネイティブ開始。同期例外の詳細文字列は捨てるため、これだけではOOM等を断定できない。 |
| `signaling_request` / `signaling_response`, `https` | `https_connection_failed` はSDKが返す接続失敗（DNS/TCP/TLSを個別には確定できない）。`https_timeout` はWorker待ち時間を含む期限切れ。ほかにread/write、容量、IPCの固定コード。 |
| `signaling_response`, `signaling` | `http_error` とHTTP status。401は認証拒否、403は権限拒否、429は制限、5xxは提供元側の失敗を調べる入口。本文を読まず、モデル名・キー・本文は記録しない。401/403だけでは拒否の詳細理由は分からない。 |
| `signaling_response`, `signaling` | `invalid_json` / `invalid_session` / `invalid_sdp` は応答形式の失敗。SDPは記録しない。`transport_answer_failed` / `transport` はネイティブへのanswer設定失敗。 |
| `transport_start` / `session_wait` または `conversation_active`, `audio_buffers` / `aec_create` / `i2s_*` / `audio_task` / `capture_open` / `render_*` 等 | ネイティブの `transport_error`。既存のstageと数値を `nativeCode` として保持する。番号の解釈は発生元のSDK/APIに従い、番号だけでOOM等を決めつけない。 |
| 同上、`webrtc` / `send` / `event_loop_watchdog` / `transport` | ネイティブWebRTC失敗、送信失敗、JSポーリング停止、予期しない切断等。`connect_timeout` は接続完了イベントまでの60秒超過で、最後のネイティブ原因の確定情報ではない。 |
| `conversation_active`, `events` | 提供元のエラーイベント等。未知の提供元コードは `provider_error` にまとめ、任意の文字列を出さない。 |
| `mute` | ミュート要求の拒否／確認タイムアウト。 |
| `conversation_close` | close例外、未finalized、`close_timeout`、`hangup_failed`、`transport_close_failed`。 |
| `amp_restore` / `radio_release` / `audio_release` | ネイティブclose待ち後のホスト資源解放。それぞれ失敗しても後続解放を試す。 |

HTTP statusは提供元から応答を受けた証拠です。`https_connection_failed` はHTTP認証拒否とは異なります。ネイティブ音声資源の作成は認証／SDP交換より前に始まるため、「接続中」の表示だけでは認証に到達したか分かりません。

## 安全なログ形式

`[openai-live] ` に続く1行JSON。既存の状態表示ログも残ります。例はテスト用の架空値で、実機計測値ではありません。

```json
{"attempt":1,"sequence":9,"phase":"signaling_response","event":"failure","primary":true,"code":"http_error","stage":"signaling","errorClass":"ConversationError","status":401}
```

- `attempt` はMOD起動後の開始回数、`sequence` はその回の順序。再起動後はリセットするため、別の起動ログは混ぜない。
- 修正後のホストは `transport_create` → `transport_start` → `signaling_request` → `signaling_response` → `transport_answer` → `session_wait` → `session_started` の進行も記録する。offer生成前、HTTP待ち、ネイティブ接続／開始通知待ちを区別できる。
- `begin` はその処理に入ったこと。後続phaseまたは `success` は完了の手掛かり。`begin` だけで止まった場合はその付近の停止を疑うが、原因確定とはしない。
- 最初の `failure` が `primary:true`。終了時の別エラーは `primary:false` として残り、元の失敗を上書きしない。
- best-effort hangupはネイティブ終了後に失敗通知が届くことがある。そのときは元の `attempt` と `conversation_close`、`late:true` で記録する。次の会話を停止しない。
- `code` / `stage` / `errorClass` は固定の許可リスト。未知の文字列、例外message／stack／toString、提供元の自由なエラーコードは出さない。HTTP statusとnativeCodeは範囲を検証した数値だけ。
- キー、Authorization、URL、SDP、session ID、モデル／指示、文字起こし、音声、提供元エラー本文は含めない。ログ失敗や不正な例外getterは会話と後始末を妨げない。
- ホスト更新なしでMODだけ更新した場合も外側のphaseは出るが、古いConversationが捨てていたHTTPS分類／nativeCodeは復元できない。

## 実機での取得手順

1. **入れ替える前に**、ボード、現在の配布元URL／ビルドジョブ、manifest、ホストとMODの元コミット、SDK／ESP-IDF版を記録する。不明な項目は不明と記載する。Webインストーラー／MOD書込みのホストdescriptorはSDK／API互換性の手掛かりで、コミットを一意には特定できない。元のBINが残っていればSHA-256も記録する。キーを含むMODや全フラッシュは公開しない。
2. 今回の修正コミットで、READMEのSDK 10.0.2／ESP-IDF 6.1／WebRTC依存関係の環境を用意する。developでは `host/app/manifest_openai_live.json` を使う。#757の標準版と専用Live版はメモリ構成が異なり、結果を同一視しない。テスト条件ごとにmanifestとバイナリ識別値を残す。
3. `firmware/` でホストとMODをdebug版としてビルドする。まず空キーでビルド確認し、自分用MODは既存の追跡外 `manifest.local.json` を使う。キーをコマンド引数へ書かない。

   ```sh
   npm run build -- --mode=debug --manifest host/app/manifest_openai_live.json
   npm run mod:build -- --mode=debug mods/examples/openai_live_webrtc/manifest.local.json
   ```

4. 当該実機にホストとMODを導入する（[MOD README](../../firmware/mods/examples/openai_live_webrtc/README_ja.md)の手順で `--mode=debug` を使用）。設定やモデル領域を消去しない。書込みツール間で同じUSBポートを同時に開かない。
5. debugホストの起動ログはxsbugのLogビュー、またはSDKのxsbug-log／serial2xsbug経由で取得する。リポジトリの `npm run debug:xsdb -- --manifest host/app/manifest_openai_live.json --port /dev/ttyACM0` も利用できるが、**これは読むだけのコマンドではなく、ホストを再ビルド・書込み・起動してログ接続する**。MODは同じdebug/SDK条件で用意しておく。ポート名は実際のものを指定する。release版のraw serialに `trace()` が現れるとは限らない。
6. Wi-Fi ready後、人が「OpenAI 会話」を一度押す。表示・押した時刻・接続に要した時間と、その起動の `[openai-live]` 行を、`host_preflight` から音声解放／遅延hangupまで保存する。自動再試行はしない。自分の操作でセッション作成／マイク送信が発生する。
7. 共有するのはこの診断のJSON行とキーを含まないビルド識別情報。SDKや他MODのログ全体、設定ファイル、MODバイナリをそのまま共有しない。実機で最初の `primary:true` のphase／code／stage／status／nativeCodeを確認して原因候補を絞る。

終了失敗のみ、接続中断、再接続、既存TTS／録音との排他も同じログで別々に確認します。APIキーをわざとログへ出す試験は不要です。

## 検証と未検証

Nodeで実際のLiveSession／Conversation／HTTP Workerキュー・プロキシを実行し、段階別の失敗、401/403/429/5xx、HTTPS分類の伝播、ネイティブ番号、秘密文字列と不正な例外getter、ログ失敗、終了中の再入、遅延hangupと再接続を確認します。

ローカル検証は `npm run test:unit -- --test-concurrency=1` が571/571、RFIDが11/11、architectureが76/76。format／lint／legacy-name／差分の空白検査も確認する。標準の並列unit実行は既存の `module-test-runner.test.mjs` の早期終了判定が1件失敗し、同ファイル単独は4/4、並列度を制限した全unit再実行は成功した。ランナー自体は変更していない。

この実行環境のMODクロスビルドは `mcrun ENOENT` で停止しました。実ターゲットビルド、XS上の新ログ、実機の認証／DNS／TLS／I2S／メモリ余裕／音声入出力／連続接続は未検証です。Nodeの注入エラーは実機原因の証明ではありません。10月31日の原因確定には、実際のホスト・MOD識別と再現時の診断ログが必要です。
