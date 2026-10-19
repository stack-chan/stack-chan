# メディアプレイヤー MOD（M5StackChan CoreS3）

1つのMODからPodcastとWebRadioの2つのmini-appを使えます。両方とも手動で再生を開始し、画面を閉じても再生を続けます。他方を再生すると、それまでの音声ストリームを停止・破棄します。PodcastのRSS・アート取得と選択情報は維持します。

PodcastのRSS、アート、一時停止・再開、シークは既存実装を使用します。対応形式・取得上限はリポジトリの `firmware/mods/examples/podcast/README.md` を参照してください。WebRadioは直接MP3ストリームを対象とし、HLS、AAC、Radiko、プレイリスト、曲名表示には対応しません。局を選んだだけでは再生せず、接続中・再接続待ちでも■で停止できます。

## 設定とビルド

リポジトリ内の `firmware/mods/examples/podcast/config.ts` で番組を、`firmware/mods/examples/web_radio/config.ts` で局を設定します。Galleryの `mod/` はこれらの公開ソースのコピーです。ビルドにはリポジトリのホスト用フォント・型定義とModdable SDK 10.0.2が必要です。

`firmware/` でビルドします。次のコマンドは実機へ書き込みません。

```sh
npm run build:m5stackchan_cores3
npm run mod:build -- mods/examples/media_player/manifest.json --mode=release
node mods/examples/media_player/sync-gallery.mjs
```

共有音量の`audio.volume`に対応したホストAPI 2以上（ファームウェア版の末尾が`+stackchan.2`以上）が必要です。GalleryはAPI 0・1のホストへの書き込みを事前に拒否し、更新を案内します。CLIなどで古いホストへ直接書き込んだ場合も、起動時に更新案内を表示します。MOD単体でホストやWi-Fi、認証情報を設定することはありません。

中国語用ビットマップフォントはNoto Sans CJK SC 2.004由来で、SIL Open Font License 1.1です。Galleryでは `LICENSE.font.txt` を同梱します。ソースと変換方法はリポジトリの `firmware/host/modules/ui/assets/fonts/StackchanCJK-Regular.README.md` に記載しています。

## 共通音量

Drawerの「音量」は既存の `tts.volume` 設定を共有し、大100%・中50%・小25%・ミュート0%を選べます。0～100%は線形の音量値です。メディア出力は既存上限0.2を掛けるため、実際のゲインは0.2・0.1・0.05・0です。同じ割合でもTTSと配信音源の聴感上の音量は異なります。

再生中のメディアには直ちに反映し、接続・再生位置を維持します。ミュートでも受信と再生を続け、音量を戻すと現在位置から聞こえます。Podcastの一時停止後やRadioの再接続後も選択値を維持します。TTSは次の発話から共通値を使い、発話中のゲイン変更は行いません。APIで明示した音量はその呼び出しの指定を優先します。

設定画面で保存した35%などの値は、起動やDrawer表示で変更しません。Drawerの見出しに正確な割合、選択欄に近いプリセットを表示し、選択操作をしたときだけ保存します。

発話・tone・音声バッファ再生はメディアを停止します。発話後の自動再開と再起動後の位置復元はありません。

## 見回す

Drawerの「見回す」は起動時OFFです。ONを選ぶと既存のmotion APIでトルクを有効にし、直ちに視線目標を設定して以後5秒ごとに更新します。OFFでは更新を止め、視線追従を解除してトルクをOFFにします。トルクの有効化が失敗した場合はOFFに戻します。音声の開始・停止や共通音量は変更しません。

実際の移動にはサーボを使用できるホスト設定が必要です。`driver: none` やサーボ電源OFFの試験用インターロックは、このMODから解除しません。

## 実機確認

現在の実機に別のMOD・認証情報がある場合は、置換前に現在のホスト、MOD archive、使用SDK、設定の保存・復元方法を確認してください。MOD archiveを書き込むだけでも既存MODは置き換わります。保存・復元の合意ができるまでは実機へ書き込まないでください。

1. 対応ホストとこのMODを用意し、Wi-Fi設定を保持して起動する。自動再生がないこと、2つのmini-appとDrawer音量を確認する。
2. Podcastで番組・エピソードを選び、再生、一時停止、再開、前後シーク、画像を確認する。画面を閉じて再表示し、継続を確認する。
3. Radioを開いて局を選び、▶で開始する。Podcastが停止し、Radioが続くことを確認する。Podcastの番組変更・RSS更新だけではRadioを止めないことも確認する。
4. Podcastを開始してRadioが停止することを確認する。両方向の切替・局変更・停止を連打しても旧音声や旧表示が戻らないことを確認する。
5. 大・中・小・ミュート・中を選び、メディアの接続と位置が維持されることを確認する。ローカルTTSで同じ設定が次の発話に反映され、メディアが停止し自動再開しないことを確認する。有料TTSは使わない。
6. 接続失敗、切断、再接続待ちでの■、停止後の遅延通知を確認する。Radioは再接続し、Podcastはエラーとなる。停止後に通信や再生が復活しないことを確認する。
7. 設定画面の任意値（例35%）を保存して再起動し、Drawerを開いても値が変わらないことを確認する。試験後は合意した手順で元のホスト・MOD・設定を復元する。

ローカルHTTP試験には `node mods/examples/podcast/fixture-server.mjs /absolute/path/episode.mp3` を使用できます。公開ストリームの接続性、実MP3デコード、DMA出力、聴感上の品質はCPUの代替依存テストでは確認できません。
