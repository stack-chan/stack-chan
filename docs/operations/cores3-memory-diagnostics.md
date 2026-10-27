# CoreS3 WebRTC メモリ診断

Release impact: **none**。PR #757 の標準構成に、明示的に選択する診断用
manifest を重ねる。配布用 manifest、WebRTC、通常の Live MOD は変更しない。
PR #744 の描画・I2S・音声・タスクトレースを含めず、タスク一覧やスタックを
走査しない。#757 の受け入れ基準全体をこの診断だけで満たすものではない。

## 計測 API と負荷

既存の `realtimeConversation.stats` は、使用中の transport に依存し、
`freeHeap` / `freeInternalHeap` のみを返す。`jpeg-scaled-decoder.memoryUsage()`
も現在の空き量のみで、普通の CoreS3 の独立した診断には適さない。

診断用ホストは `memory-diagnostics/heap` の `snapshot()` を公開する。
ESP-IDF の `heap_caps_get_info()` を次の capability で呼ぶ。

| ログ内の領域 | capability | 各領域の値（すべて byte） |
| --- | --- | --- |
| `internal` | `MALLOC_CAP_INTERNAL \| MALLOC_CAP_8BIT` | `freeBytes`, `allocatedBytes`, `minFreeBytes`, `largestFreeBytes` |
| `psram` | `MALLOC_CAP_SPIRAM \| MALLOC_CAP_8BIT` | 同上 |
| `all8bit` | `MALLOC_CAP_8BIT` | 同上 |

3領域ともネイティブのスタック上へ取得した後で XS の結果オブジェクトを
作る。`uptimeMs` は起動からの単調増加時刻。実効ビルド設定の
`internalReserveBytes` と `alwaysInternalBytes` も出力する（未定義なら省略）。
PSRAM の使用中量は `allocatedBytes` で確認できる。

- `minFreeBytes` は起動からの各ヒープ領域の low-water mark の合計。
  各領域が同時に最小になった値とは限らず、接続サイクルごとにはリセットしない。
  ESP-IDF の global/local minimum monitor は操作しない。
- `largestFreeBytes` はその瞬間の最大連続空き領域。短い断片化のピークは
  取り逃がし得る。内部8bitヒープの値は、特定の DMA capability / alignment で
  確保できるサイズの保証ではない。`all8bit` は他領域と重なるので足し合わせない。
- 各 API 読み取りは順次実行する。別タスクの確保・解放に対して全体が atomic ではない。
  予約値96KiBは「常に96KiB使用中」を意味しない。実測なしに影響を断定しない。
- 診断は GC、ネットワーク接続、WebRTC transport の生成を起こさない。
  XS オブジェクトと JSON/trace のコストはあるため、比較対象にも同じ診断差分を使う。
  出力済みのサンプルは保持しない。
- 通常 manifest からはこのモジュールを参照しない。診断中もポーリングや
  常設タスクを追加せず、操作時の取得と最大1個の一回限りのタイマーだけを使う。

API の意味は [ESP-IDF v6.1 のヘッダー](https://github.com/espressif/esp-idf/blob/v6.1/components/heap/include/esp_heap_caps.h)
に従う。

## ビルド（実機へは書き込まない）

通常の Moddable 10.0.2 / ESP-IDF 環境を用意し、`firmware/` で実行する。

```sh
npm ci
npm run test:memory-diagnostics
npm run test:memory-diagnostics:build:cores3
npm run test:memory-diagnostics:build:m5stackchan_cores3
```

後者は M5StackChan 標準ホスト固有の manifest を維持する。
Live の性能用 manifest や #744 の計測 manifest は重ねない。
診断オーバーレイ自体は `esp32Config`、予約値、VM 初期割当、クロック、
タスク優先度を変更しない。既存ラッパーの `dist/` 出力先と variant 切り替えを使う。
このコマンドはビルドのみであり、接続・書き込み・消去はしない。

測定前に、使う診断 manifest の `config` に識別用の値を追加するとログを識別しやすい。
例の識別子は測定結果ではない。

```json
{
  "config": {
    "memoryDiagnostics": { "runId": "cores3-candidate-run01" }
  }
}
```

未指定時は `runId: "unlabelled"`。ホスト側の設定であり、API キー等は含めない。

## WebRTC 未使用時

1. ボード、ポート、配置・設定の保全を確認してから、別途承認された手順で
   診断ホストを用意する。この作業で実機を書き換えたという記録は作らない。
2. 通常ホストを MOD なしで起動すると、標準の機能を残してドロワーに
   「メモリ測定段階」「メモリ記録」が増える。初回の `idle-unused` は
   context 構築直後であり、Wi-Fi 接続完了を意味しない。
3. Wi-Fi 接続と起動処理が完了してから5秒待ち、段階 `idle-unused` で
   「メモリ記録」を押す。各試行で同じ画面・同じ待ち時間・同じ周辺機能を使う。
   この経路は `realtimeConversation` を import しない。

## 接続・終了・再接続

既存の `openai_live_webrtc` に、診断版の MOD manifest を追加してある。
診断ホストとともに使い、通常の `session.js` の音声リース・アンプ・Wi-Fi
所有権処理をそのまま通す。診断ホストなしでは使えない。
会話先の設定は従来と同じ方法でローカルに用意する。API キーをコミットしない。

```sh
npm run test:memory-diagnostics:mod:build:cores3
npm run test:memory-diagnostics:mod:build:m5stackchan_cores3
```

対象ホストに対応する一方を選ぶ。これは MOD アーカイブのビルドのみ。
通常CoreS3用のコマンドは追加引数を拒否し、書き込み操作を受け付けない。
インストール・接続は別操作。
診断 MOD は自動で接続しない。「OpenAI 会話」を明示的に操作して開始・終了する。
初回 `idle-unused` は診断 MOD の context 入口で記録し、その後に元の MOD が
WebRTC を import する。MOD なしの baseline と MOD 読み込み後の idle を混同しない。

| phase | 測定するタイミング |
| --- | --- |
| `idle-unused` | context 入口、または手動。手動の比較値は起動・ネットワーク安定後5秒に統一 |
| `before-connect` | LiveSession 開始通知時。ネットワーク待ち・音声リース取得・transport 生成より前 |
| `connecting-1s` | 開始通知から1秒後、まだ connecting の場合だけ。Wi-Fi 待ちも含むため、交渉比較では先にネットワークを安定させる |
| `connected` | connect 完了通知時 |
| `connected-5s` | connected が続いている場合、その通知から5秒後。双方向音声の成立を保証しない |
| `duplex` | 双方向音声を人が確認し、同じ会話負荷を5秒続けてから手動で記録 |
| `before-close` | 終了要求時。ネイティブの終了待ちに入る前 |
| `closed` | awaited close 後、アンプ復元・radio と audio リースの解放まで済んだ idle 通知時 |
| `closed-5s` | idle が続いている場合、その通知から5秒後 |
| `post-close` | 任意の手動再確認。比較時は終了後の待ち時間を揃える |
| `configuration` / `error` | 設定・接続・終了・解放の失敗通知。正常終了の代替にはしない |

終了・エラー・再接続時は以前の一回限りのタイマーを取り消す。
早く接続できた試行では `connecting-1s` はなく、5秒以内に切断した試行には
`connected-5s` はない。欠けた段階を架空の値で補完しない。
`cycle` は開始操作ごとに増え、失敗した開始も数える。
MOD を再読み込み・再起動すると cycle / sequence はリセットされる。

`closed-5s` を待ってから次の接続を開始し、最低10回、同じ手順で反復する。
同一 MOD・同一 VM のまま繰り返し、初回と2回目以降を区別する。
一度生成された HTTPS Worker はメイン VM の存続中に再利用されるため、
初回終了後が未使用 idle と完全一致しなくても、それだけでは leak と判断できない。

## ログと比較

シリアル / xsbug の `[memory] ` で始まる各行を保存する。後続は1行の JSON。
生の API 応答、SDP、発話内容、API キー、例外メッセージは記録しない。

| フィールド | 意味 |
| --- | --- |
| `schema` | ログ形式の版（1） |
| `runId` | ホスト設定の実行識別子 |
| `sequence` | recorder 内の連番 |
| `cycle`, `state`, `phase` | 接続試行番号と測定位置 |
| `status` | `sample` は取得成功のみ。実機受け入れの PASS ではない。`unavailable` は取得失敗で heap を含まない |
| `heap` | 上記 API の取得結果。メモリ不足時は JSON/trace 自体が失敗して行が欠けることもある |

同じ runId に紐づく別の測定メモへ、host SHA、SDK SHA/version、ESP-IDF、
ボード、manifest/mode、MOD、実効 sdkconfig、manifest_flat、バイナリ hash/size、
周辺機能・ネットワーク条件を記録する。ログから未記載の環境を推測しない。

- #757 適用前後の比較は、同じ診断差分を両方へ適用し、同じボード・SDK・
  build mode・MOD・起動条件で行う。before と after で別 runId を使い、
  `idle-unused` の内部空き量と最大連続領域を比較する。
- 接続の影響は同じ試行内の `before-connect` と active / `closed-5s` を比較する。
  反復時は各 cycle の `closed-5s` の内部空き量・PSRAM使用量・最大連続領域を並べる。
  `minFreeBytes` は履歴値なので、終了しても増えない。
- 予約値だけの影響を調べる場合は、#757 の前後比較とは別の試験として、
  同一ソースで予約値のみを変えたビルドを使う。他の構成差を予約の影響と断定しない。
  自動的な合否閾値や「leak 判定」は設けない。

## 検証状態

自動テストは実際の C binding をホスト上の XS/heap API スタブで実行し、
領域の取り違え、PSRAMなし、結果オブジェクト確保前の取得を確認する。
JS テストは実際の LiveSession と組み合わせ、終了待ち・ホスト資源解放後の
測定、再接続の連番、タイマー取消、診断失敗の隔離を確認する。
スタブ値はテスト用データであり、ボードの計測結果ではない。

**NOT RUN**: ESP-IDF/XS 実ターゲットでの診断ビルド、両ボードでの起動、
idle / negotiation / duplex / close / reconnect の実測、メモリ余裕・
音声・UI・タスクスタックの合否。実機データと受け入れ結果はまだない。
