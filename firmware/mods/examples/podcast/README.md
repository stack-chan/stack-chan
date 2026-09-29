# Podcast MOD（M5StackChan CoreS3）

mini app の画面で登録した RSS 2.0 フィードからエピソードを選び、MP3 を再生します。対応するホストファームウェアへの更新が必要です。

## 登録とインストール

1. `config.ts` の `feeds` に番組名と RSS URL を記入します。登録内容は MOD に含まれます。

   ```ts
   export const feeds: { title: string; url: string }[] = [
     { title: 'My Podcast', url: 'https://example.com/podcast/feed.xml' },
   ]
   ```

2. Wi-Fi を設定し、`firmware/` でホストと MOD を書き込みます。

   ```sh
   npm run build:m5stackchan_cores3
   npm run deploy:m5stackchan_cores3
   npm run mod:m5stackchan_cores3 -- mods/examples/podcast/manifest.json
   ```

   ビルドだけを行う場合：

   ```sh
   npm run build:m5stackchan_cores3
   npm run mod:build -- mods/examples/podcast/manifest.json --mode=release
   ```

3. 画面上部の mini app ランチャーから「Podcast」を開きます。
   - 「番組」「エピソード」をタップして一覧から選びます。「前へ」「次へ」でページを切り替え、「戻る」で再生画面に戻ります。
   - ▶／Ⅱ で再生・一時停止・再開、■ で停止します。シークバーをタップまたはドラッグして再生位置を移動できます。「一覧更新」で RSS を取得し直します。取得中・再生中・終了・エラーは画面内に表示します。
   - 上部バーからアプリを閉じても、再生と顔の音符エフェクト、RSS 取得は続きます。再び開くと現在の再生位置と選択済みのエピソードを表示します。
   - 起動・番組変更・一覧更新では自動再生しません。ドロワーへの Podcast 操作項目の追加は行いません。

通常の MOD の `onContextCreated` から `context.ui.miniApps.register()` で登録しています。音声・RSS 処理はホストの権限を持つ MOD が担当し、画面の終了時には UI の購読を解除します。再生の寿命は MOD が管理します。隔離された `miniapp` エントリーポイントは使いません。

## 対応範囲

- HTTP/HTTPS の直接 MP3。相対 URL を含む最大 5 回のリダイレクトに対応します。TLS 証明書検証は有効です。ホストが信頼する CA によっては接続できない配信元があります。
- MP3 の入力は 44.1 kHz / 48 kHz。ホストの既存デコーダでモノラル 24 kHz に変換します。先頭の ID3v2 タグを読み飛ばします。音量の上限は 0.2 です。
- 有限長の応答は Content-Length または chunked framing が必要です。受信終了後も残りの音声を再生し、出力完了後に終了を表示します。切断や不完全な応答はエラーにし、先頭からの自動再接続は行いません。
- RSS は UTF-8 の RSS 2.0。番組・エピソードタイトル、GUID、MP3 enclosure を取得します。最大 1 MiB、20 エピソード、フィールド・トークン各 8 KiB、深さ 32。上限に達した場合は、その時点までの完全なエピソードを表示します。取得は最大 30 秒、ネットワーク無応答は 10 秒で打ち切ります。
- enclosure の `type="audio/mpeg"` を採用します。type が未指定または `application/octet-stream` の場合は `.mp3` URL のみ採用します。GUID がない場合は enclosure URL を識別子にします。
- 発話・tone・音声バッファ再生は Podcast を停止します。発話後の自動再開、再起動後の途中再開、再生履歴、番組検索、AAC/M4A、HLS、Radiko には対応していません。
- 他ターゲットへの展開は未対応です。

## 一時停止・シーク

- 再生位置は出力ドライバーが消費した PCM から更新します。一時停止では通信と出力を解放し、再開時に保存した位置から取り直します。停止・エピソード変更・発話による割り込みで位置をリセットします。
- 再生時間は MP3 の Xing/Info/VBRI、RSS の `itunes:duration`、Content-Length とビットレートの順に利用します。後二者は「約」と表示し、VBR と判明した場合はビットレートによる推定を取り消します。長さが不明な間はバー操作を無効にします。末尾まで解析した時点で実際のフレーム長に更新します。
- シークは記録したフレーム境界から HTTP Range で取得し、1 秒のプリロール後に指定位置以前の PCM を捨てます。VBR もフレームごとの時間で計算し、バイト比率では位置を決めません。MP3 のエンコーダー遅延・末尾パディングを除くギャップレス再生は未対応です。
- 未取得の遠い位置ではフレームを順に確認する待ち時間が発生します。Range 非対応のサーバーでは先頭から取り直します。チェックポイントは最大 512 件に制限し、長い番組では間隔を広げます。通信エラーは画面に表示します。

## 共通プレイヤー API

```js
await context.audio.media.start({
  url: 'https://example.com/episode.mp3',
  mode: 'finite', // 'live' は従来の再接続動作
  onProgress({ position, duration, estimated, seekable }) {
    // 出力側の秒数。約 250 ms ごとに通知
  },
  onStateChanged(state, reason) {
    // idle / connecting / buffering / playing / stalled / retrying / error / paused / ended
    trace(`${state}: ${reason ?? ''}\n`)
  },
})
context.audio.media.pause()
await context.audio.media.seek(30) // 秒。一時停止中なら移動後も一時停止を保つ
await context.audio.media.resume()
const { position, duration, estimated, seekable } = context.audio.media.progress
context.audio.media.stop()
```

`start()` の完了は再生開始要求の受付を表します。再生完了は `ended` で通知します。`audio.webRadio` は同じプレイヤーを使用するライブ再生用の互換 API です。発話中などは `start()`・`resume()`・`seek()` が `audio busy` で拒否されます。

## 検証

```sh
npm run test:unit
STACKCHAN_MODULE_TEST_FILTER=media-playback npm run test:moddable
STACKCHAN_MODULE_TEST_FILTER=podcast-ui npm run test:moddable
```

XS テストでは HTTP・出力ドライバー・MP3 デコーダを代替し、実際の共有バッファ、デコード制御、ネイティブ PCM リサンプラー、プレイヤー、RSS 取得、画面への状態通知を通します。Piu の画面テストでは選択、ページ移動、再生停止、取得中の操作制限、終了・再表示と 320×196 の表示領域内への配置も確認します。シークの回帰テストは `screen.context` のタッチ開始・移動・終了を通し、ネイティブの `captureTouch` 呼び出しも検証します。実機の MP3 デコードや DMA 出力の代替にはなりません。

実機確認用サーバーは手元の MP3 を指定して起動します（LAN から接続可能な開発環境で使用）。

```sh
node mods/examples/podcast/fixture-server.mjs /absolute/path/episode.mp3
```

表示されたポートを使い `http://<PCのLAN IP>:8080/feed.xml` を登録してください。Content-Length（Range 対応）、chunked（Range 非対応）、相対リダイレクト、途中切断のエピソードが表示されます。44.1/48 kHz、短い音声、大きな ID3 タグ付き音声で、末尾の音が欠けないこと・終了後に再接続しないことを確認します。再生中の停止、一時停止・再開、前後へのシーク、mini app を閉じた後の継続・再表示、連続選択、発話による停止、切断時のエラー、終了後の再選択も確認します。

既存 WebRadio は同じホストに `mods/examples/web_radio/manifest.json` をインストールし、選局・停止・切断後の復旧を確認してください。

### 実機確認（2026-09-29）

M5StackChan CoreS3（ttyACM0）と NPR News Now の MP3 で、RSS 一覧取得、再生位置の進行、mini app 終了後の再生・音符エフェクト維持、再表示、一時停止、120 秒への移動、再開後の位置の進行、停止を確認しました。XS デバッガーから画面の操作を呼び出して確認しています。実際の指によるドラッグ操作と聴感上の音質は別途確認が必要です。

遠い未取得位置への移動では約 40 秒の読み込みが発生しました。また、再取得が一度無応答タイムアウトとなり、シークを再試行して再生できました。ネットワークの遅延・切断時にはエラーを表示し、有限長音声を自動で先頭から再生し直しません。

ドラッグ開始時の再起動は `captureTouch` への `ticks` 引数の欠落による未処理例外（`SyntaxError: xsArg(3): invalid index`）としてシミュレーターと実機で再現しました。タッチイベントから `ticks` を受け取って渡す修正を行っています。修正後は実機でも Piu のタッチ開始・移動・終了を 10 回繰り返し、指定位置の通知と例外が発生しないことを確認しました（この UI 検証ではシーク先の通知を記録関数で受けています）。
