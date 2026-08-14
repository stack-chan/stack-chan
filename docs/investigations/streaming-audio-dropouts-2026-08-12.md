# stack-chan-ai 音声再生途切れ調査

## 目的と現在の結論

この文書は、M5StackChan CoreS3 で stack-chan-ai の応答音声が頻繁に途切れる事象について、2026年8月14日までの観測事実と未解決事項を引き継ぐための記録である。
会話開始までの遅延ではなく、PCM16 24 kHz mono の再生中に発生する無音と音の欠落を対象とする。
原因切り分けと対応策を分け、未検証の推測を確定事項として扱わない。

追加測定により、支配的な発生機構をWSS/TLS受信のburst空白、JSON/Base64の転送量増加、サーバー側の実時間ペーシング、24 kHz PCMの継続帯域不足の組み合わせまで絞り込んだ。
`elecom2g-a4632d`で24 kHz binary PCMを送った2回の実効受信速度は36,126 B/sと35,413 B/sであり、再生が消費する48,000 B/sを下回った。
90秒のPCM受信に119.583秒と121.990秒を要し、どちらもリングバッファが空になった。

一方、16 kHzの実効受信速度は32,474 B/sと38,249 B/sであり、再生が消費する32,000 B/sを満たした。
同じWi-Fiの2回と切替前の1回ではアンダーランが0回だった。
8 kHzの2回も、16,000 B/sの消費に対して約25.1 kB/sを受信し、アンダーランは0回だった。

WSS/TLS受信には16 kHzと8 kHzでも最大約0.72秒の空白が残り、調査全体では最大0.956秒、すなわち約1秒を観測した。
1秒プリバッファはfixtureの16 kHz試験ではこの空白を吸収できたが、平均受信速度が再生速度を下回る24 kHzでは、プリバッファを使い切った後に回復できなかった。
認証済みの通常会話では16 kHz binary PCMによる複数ターンの会話が成立したが、長い応答1件で4,096 byteの不足と2回のemptyを観測した。
この結果から、16 kHz化で支配的な途切れは改善したものの、1秒プリバッファだけで通常会話のアンダーランを常に防げるとは判定しない。
CPU 0とCPU 1の平均使用率は16.5–33.9%、p95は29–43%であり、空きシステムメモリは約6.27–6.29 MBだった。
CPUまたはメモリの飽和は観測していない。

JSON/Base64はbinary PCMより転送量を約34%増やす。
サーバー側の実時間ペーシングは受信側へ十分な先行データを渡さないため、burst空白がそのままリング残量を減らす。
この二つを除いても24 kHzの必要帯域には届かなかったが、16 kHzへ下げると再生速度を上回る受信余裕を確保できた。

本調査の修正案は、出力PCMだけをbinary frameにし、人工的な実時間ペーシングを外し、通常経路の既定値をPCM16 mono 16 kHzにする。
OpenAI Speech APIのraw PCMは24 kHz固定なので、stack-chan-ai側でストリーミング中に16 kHzへ線形補間する。
通常イベントはJSON text frame、認証はHTTP Upgrade headerのまま維持する。
本番Workerへ修正をデプロイし、fixtureの24 kHz、16 kHz、8 kHz A/B、release実機への書き込み、認証済み通常会話まで実施した。
長い通常応答で残った小規模な不足に対し、開始閾値だけを1秒から1.25秒へ変更した。
8月14日の通常応答では最大受信空白477 msに対してdeficitとemptyがともに0で、リング最小残量832 byteだった。
長い応答の反復試験は残るが、短い通常応答では1.25秒版の効果を定量確認できた。

1.25秒版で新たに報告された「応答開始後にアイコンを残して画面と再生が止まる」事象は、プリバッファとAudioOutの開始順序が原因だった。
WorkerがPCMをmainへ公開する前に`listen`を送り、空のAudioOut writable callbackがmainのmessage処理を占有していた。
16 kHz無ペーシングfixtureでhard freezeを再現した後、`receiveAudio`を先に送り、その後でAudioOutを始める順序へ変更した。
`response.created`では再生状態へ遷移せず、公式`ChatAudioIO`の入力処理と顔の自律モーションを維持する。
修正後の90秒fixture 3回は90.576秒、90.640秒、90.638秒で終端し、途中59.6秒の室内録音では50 ms以上の1 kHz欠落が0回だった。
認証済み通常応答も再生後に入力状態へ戻り、3分を超えたサーバー生成待ちの間もmainはデバッガへ応答した。

「AI接続で問題が起きました」の後に再起動する事象には、少なくともDNS受信処理、TCP受信終了処理、WebSocket Upgrade送信処理の三つの独立した経路があった。
最初に特定したDNS経路では、UDPのreadable callbackが`count > 1`を受け、最初のDNS応答でsocketを閉じた後も同じcallbackが閉じたsocketを再度`read()`していた。
このとき`xsGetHostData: invalid host data (in read)`が未処理例外となり、abortと再起動へ至った。
公式resolverを置換せず、DNS用UDP socketのreadable burstを1 packetずつ直列化する薄いwrapperを追加し、制御再現で修正効果を確認した。

その後に再現した「利用者が話した後にマイク表示と顔が止まる」事象は、マイクPCMをRealtime Workerへ送るnative queueの相互待ちだった。
mainは8 kHz PCMを連続投稿して長さ10のqueueを満たし、WorkerはWebSocket書き込み通知を同じ満杯のqueueへ投稿しようとしていた。
mainとWorkerの両方が同じqueueの空きを待つため、音声入力、画面、顔、接続処理がまとめて停止した。
派生`ChatAudioIO`からnative queueへ入れるマイクPCMを一件に制限し、Workerが受理したことを通知してから次を送るACK型のbackpressureへ変更した。
main側の待機列は64 KiBで打ち切り、Workerが停止した場合は無制限にメモリを増やさず会話を失敗として閉じる。
このACKを1 KiB単位で直列化すると処理速度が約6.8 KiB/sに落ち、約16 KiB/sのPCM入力へ追いつかないことを追加計測で特定した。
既存待機列の連続領域を一件へ結合するとPCM待機列は安定したが、JSON/Base64の上りWebSocket待機列が118.310秒で64 KiBへ達した。
マイクPCMAだけをbinary frameへ変更し、通常イベントはJSON text、認証はHTTP Upgrade headerのまま維持した。
Cloudflare WebSocketの既定`Blob`受信を`ArrayBuffer`として扱う設定も共通adapterへ追加した。
修正後の本番経路は200.583秒で3,185,664 byteの入力PCMを処理し、PCM待機列は最大21,504 byteから解消し、WebSocket待機列も0へ戻った。

この停止を直した後、相手側が音声送信後に正常切断した条件で、Moddable 9.0.0のTCP受信終了と未読bufferの処理が競合して再起動した。
受信終了時に接続のerror callbackだけを先に外すと、接続構造体を解放したことがsocket所有者へ伝わらず、遅れて実行された受信量通知が解放済みの接続を参照していた。
基盤側で接続ポインタを同期的に再確認してから受信量を通知し、接続解放時にポインタを無効化するcallbackを終了処理まで維持した。
この修正はstack-chan内のSDKパッチとして保持せず、Moddable upstream候補コミット`60a320467`へ分離した。
upstream反映までは、このコミットを含むModdable checkoutを使ってstack-chanをbuildする必要がある。
同等の修正を入れた実機では、実時間ペーシング1回と無ペーシング高負荷3回の16 kHz binary fixtureが、停止と再起動なしで終端した。

三番目の経路では、Moddable 9.0.0の公式`WebSocketClient`がTLS socketから通知された書き込み可能量を無視し、HTTP Upgrade要求全体を一度に渡していた。
TLS直下のLwIP socketは書き込み可能量を超える要求を受理できないため、認証headerを含む本番Realtime接続がWorkerへ到達する前に失敗していた。
12,370 byteの診断用Upgrade要求では最初に5,648 byte、以降に2,771 byteずつしか書き込めない条件を実機で観測した。
公式クライアントを要求残量と書き込み可能量の小さい方だけ送る状態機械へ変更すると、同じ要求を4回に分けて本番Realtimeへ接続できた。
同じMODのまま旧hostへ戻すと`CONNECTED`へ到達せず、control WebSocket error、Wi-Fi再接続、`RTC_SW_CPU_RST`の順で再起動したため、接続エラー後の再起動を制御条件で再現できた。
この修正もstack-chan内へパッチを残さず、Moddable upstream候補コミット`07361c0c5`へ分離した。

PCMが0 byteの応答で250 msのsilenceを再生していた経路も特定し、再生状態へ移らずマイク入力を維持するようにした。
漢字を`chinese letter`と読む事象は応答本文の証跡がなく、会話生成と音声合成のどちらが原因かは未判定である。

control WebSocketの接続状態をRealtime開始条件から外し、heartbeatは一回のACK欠落では切断せず連続3回まで観測する。
バックグラウンド設定更新の一時失敗も画面上の致命的エラーとして扱わない。
前方スワイプの開始音、後方スワイプの終了音と会話終了、会話状態アイコンのメイン領域への移設、ROBOT LISTENING中の吹き出し非表示も同じ製品候補へ追加した。

I2S出力単体は90秒音源を欠落なく再生したため、スピーカーとローカルPCM出力は主因ではない。
同一固定音声による実機A/Bでは、GCM providerを使ってもアンダーランは解消せず、TLSのAES-GCM復号負荷も支配的原因ではない。
Wi-Fi省電力、メインスレッド上のUI処理、WebSocket Workerからメインへの通知揺らぎには寄与があるが、それぞれの対策だけでは本番経路を安定させられなかった。
Moddable 9.0.0の`WebSocketStream`への置換は、open前の受信データを失う回帰と約72 KBの依存増加を実測したため、採用しない。

## 基準条件

| 項目 | 条件 |
| --- | --- |
| 実機 | M5StackChan CoreS3 |
| USB 識別子 | `44:1B:F6:E2:82:B0` |
| 通常のデバイス | `/dev/ttyACM0` |
| Wi-Fi | `elecom2g-a4632d` |
| 実機 IP | instrument測定時に`192.168.7.145`を確認 |
| stack-chan | 修正worktreeの基点`73067e467d7831f2488f4d0ce8058d63189e3232`、候補head`4c40727b` |
| stack-chan-ai | 修正worktreeの基点`a499a28`、候補head`75680ab` |
| Moddable | 9.0.0、`b1f42a2e148f0fc2cd91d7ed1cee56bd361656b2` |
| ESP-IDF | 最新のrelease書き込みはv6.0.0、以前のGCM評価はv6.0.2 |
| GCM provider | 未適用を基準条件とする |
| プリバッファ | fixtureと最初の通常会話は1秒、現在の候補は1.25秒、閾値は20,000–60,000 byte |
| Wi-Fi 省電力 | `WIFI_PS_NONE` |
| 最新A/Bの再生音量 | probeで0に固定 |
| 8月14日の通常会話音量 | 0.18 |
| 本番Worker | `8dd4e0be-3e35-44f7-b28c-ba6ff40aafa8` |
| 最新標準release build | 6,165,584 byte、SHA-256 `0d2ea06e787116cf02414bd07d047a79248621ac9cccf23e3a2f0b58eb792fcf` |
| Moddable TCP修正 | upstream候補`60a320467`（`fix/lwip-tcp-receive-lifetime`） |
| Moddable WebSocket修正 | upstream候補`07361c0c5`（`fix/websocket-handshake-backpressure`） |
| 計測追加 | 受信間隔、empty、partial、deficit、リング残量、CPU、メモリを一時計測 |

以前のESP-IDF v6.0.2評価では、tagのcheckoutだけではなく、Moddableのupdate guideに沿ってPython環境、managed component、submoduleを更新した。
`git submodule status --recursive`で不整合がないことを確認した。

## ログを読むための前提

ChatAudioIO の `SPEAKING` は利用者が話す入力ターンを表す。
`LISTENING` はｽﾀｯｸﾁｬﾝが応答音声を再生する出力ターンを表す。
`WAITING` は出力終端を受け、残ったバッファを排出している状態を表す。

初期調査のexact-empty underflowは、AudioOutの一回の要求にChatAudioIOが一バイトも返せなかった状態である。
追加probeの`emptyDeficits`は0 byte返却、`partialDeficits`は要求量未満の返却、`deficitBytes`は要求量と実際の返却量の差を表す。
AudioOutは不足直後に次のcallbackを要求できるため、`deficitBytes / bytesPerSecond`をそのまま無音時間として解釈できない。
再生時間の伸び、リング残量、emptyとpartialの回数を合わせて判定する。

## 測定結果

| 条件 | 観測結果 | 判定 |
| --- | --- | --- |
| ローカル PCM 出力のみ | 約89.98秒、10 ms以上の欠落0回 | I2S、AudioOut、スピーカー単体の常時不良を支持しない |
| 対策前の WebSocket 通知 | 最大1,117 ms、200 ms超132回 | 実機内の通知遅延を確認 |
| Wi-Fi 省電力無効 | 100 ms超304回から44回、200 ms超132回から7回、最大863 ms | 100 ms超を約86%、200 ms超を約95%削減 |
| Wi-Fi 省電力無効の可聴試験 | 欠落3回、合計180 ms、最大80 ms | 有効だが欠落は残る |
| 1秒プリバッファ、顔停止、1回目 | 有効再生約86.5秒、exact-empty 0回 | 一時的には吸収できた |
| 同条件、2回目 | 約90.04秒、20 ms以上の欠落0回 | 再現性を確認 |
| 同条件の受信通知 | 最大781 ms、100 ms超161回、200 ms超12回 | プリバッファは通知揺らぎを隠すが解消しない |
| 顔 UI を戻した1回目 | 約90.02秒、20 ms以上の欠落0回 | 単発では再現せず |
| 顔 UI を戻した2回目 | 通知最大1,134 ms、実音声欠落約330 msが1回 | UI 処理の関与を支持 |
| UI 有効、2秒プリバッファ | 通知最大2.614秒、実音声欠落約770 ms | バッファ増量だけでは解消しない |
| 顔停止、2秒プリバッファ、2回 | 100 ms超の内部 underflow なし | 顔処理停止による改善を支持 |
| PR #634 の Worker priority 5、core 0 | `modMessagePostToMachine timeout` が直ちに発生 | この scheduling は不採用 |
| PR #634 の Worker priority 4、core 固定なし | 約94.38秒で欠落11回、合計3.70秒、最大1.45秒、通知最大3.883秒 | 単独移植案を棄却 |
| GCM ありの動的会話 | 約155秒、200 ms以上の録音欠落0回、最大190 ms | 改善を示唆するが同一条件比較ではない |
| no-GCM の動的会話 | 過去2回の exact-empty は2回と1回 | GCM との直接比較には使えない |
| no-GCM の直近長文 | 再生状態約230.7秒、exact-empty 3回 | 対策後も症状が残る |
| no-GCM の固定 WSS、2回目 | 90秒音源の排出に177.37秒、exact-empty 1回、100 ms以上の録音上の無音347回 | counter は頻繁な部分的供給不足を捉えない |
| GCM の固定 WSS、1回目 | 排出172.93秒、exact-empty 3回、20 ms以上の無音366回・合計78.51秒 | 激しい途切れが残る |
| GCM の固定 WSS、2回目 | 排出177.81秒、exact-empty 3回、20 ms以上の無音364回・合計83.45秒 | 1回目の小幅改善は再現しない |

直近長文の録音では、100 ms以上の低レベル区間が17回、200 ms以上が3回、最大540 msだった。
200 ms以上の3区間は exact-empty 3回と一致した。
利用者の聴感では少なくとも数十回だったため、より短い部分的な供給不足を次に計測する必要がある。
録音ピークは20,532で、PCM のクリップは0サンプルだった。
音量過大やクリッピングでは、この試験の途切れを説明できない。

## 確認できた寄与要因

### Wi-Fi 省電力

省電力無効化で長い通知間隔が大幅に減ったため、途切れへの寄与がある。
ただし、ESP-IDF v6.0.0 から v6.0.2 のどこで挙動が変わったかは未特定である。

### UI とメインスレッド

呼吸、まばたき、視線、LED 更新はメインスレッドの処理量を増やす。
顔停止時に改善し、UI を戻した試験で1秒を超える通知停止が再現したため、UI 処理の関与を支持する。
PR #650 では stack-chan host の `FaceView.onChatState` が `LISTENING` と `WAITING` で自律モーションを止め、`SPEAKING` で再開する。
口パクは125 ms単位に間引いて残す。
stack-chan-ai はターンイベントだけを配信し、顔を止める判断は host が持つ。
この変更にサーバーの再デプロイは不要である。

### 半二重化

応答再生中に AudioIn と AEC を止めることで、出力と入力処理の競合を減らせる。
PR #632 を含まない初期条件でも頻繁な途切れがあったため、AEC 単独では症状を説明できない。
PR #634 全体ではなく、ターン交代に必要な最小差分を保つ。

## GCM provider の評価

GCM provider は TLS レコードの AES-GCM 復号を ESP-IDF 側へ委譲し、XS の CPU 使用量を減らす。
provider は任意機能であり、パッチを置くだけでは有効にならない。
CoreS3 の app manifest から `modules/crypt/ssl/esp32/manifest.json` を明示的に include し、通常の `ssl/gcm` を除外する必要がある。
GCM版の生成 manifest、`ssl_gcm.c.o`、ELF の `xs_esp32_gcm_constructor/process/destructor` を照合し、ネイティブproviderがリンクされたことを確認した。
Cloudflare はModdable互換のTLS 1.2 cipher群から `ECDHE-ECDSA-AES128-GCM-SHA256` を選択した。
xsdbでも `GCM → setupSub → SetupCipher → TLS handshake` の実行スタックを捕捉し、実機がproviderを通ったことを確認した。

10 ms窓で1 kHz成分を判定した結果は次の通りである。

| 条件 | 有音区間幅 | 20 ms以上の無音 | 100 ms以上 | 200 ms以上 |
| --- | ---: | ---: | ---: | ---: |
| no-GCM | 175.72秒 | 365回、81.33秒 | 347回、80.41秒 | 289回、70.29秒 |
| GCM 1 | 171.37秒 | 366回、78.51秒 | 338回、76.75秒 | 305回、71.45秒 |
| GCM 2 | 175.89秒 | 364回、83.45秒 | 341回、81.91秒 | 309回、76.93秒 |

GCM 2回平均の20 ms以上の無音は365回、80.98秒で、no-GCMの365回、81.33秒と実質同じだった。
排出時間もGCM 2回平均175.37秒に対してno-GCM 177.37秒で、GCM 2回の範囲がno-GCM値をまたぐ。
今回の標本ではGCM単体の改善を支持せず、途切れ対策として必須化しない。

## ESP-IDF v6.0.2 の評価

v6.0.2 には WebSocket、HTTP 接続再利用、I2S クロック管理、LwIP の変更が含まれる。
更新後の基準条件でも動的会話の途切れが再現したため、v6.0.2だけで解消する仮説は支持されない。
省電力挙動の回帰点が必要になった場合は、同じ固定 WSS と同じ host で IDF だけを切り替える。

## Cloudflare 固定音声経路

stack-chan-ai PR #1 の fixture はローカル Node.js サーバーだけであり、LAN の非 TLS 試験しかできなかった。
この条件では「非 TLS は滑らかだが TLS で途切れる」という仮説を検証できない。

PR #2で認証不要の`/fixture/device/v1/realtime`をCloudflare Workerへ追加した。
この経路はOpenAI、データベース、デバイス認証を使わず、90秒の1 kHz PCM16 monoを配信する。
初期版のWorker versionは`3d8c7997-d546-470c-83a8-00ac94005b85`だった。
2026年8月13日後半にrate、encoding、pacingを選べる修正をデプロイした。
2026年8月14日には応答完了後の相手側正常切断を再現する`close`指定を追加し、最新versionは`8dd4e0be-3e35-44f7-b28c-ba6ff40aafa8`になった。

公開接続先は次の URL である。

```text
wss://stackchan-ai-device.meganetaaan.com/fixture/device/v1/realtime
```

fixtureは次のquery parameterを検証する。

| parameter | 値 | 既定値 |
| --- | --- | --- |
| `sample_rate` | `8000`、`16000`、`24000` | `24000` |
| `codec` | `pcm16` | `pcm16` |
| `encoding` | `session`、`binary`、`base64` | `session` |
| `pacing` | `realtime`、`none` | `realtime` |
| `close` | `keep`、`done` | `keep` |

最新A/Bで使った16 kHz接続先は次のとおりである。

```text
wss://stackchan-ai-device.meganetaaan.com/fixture/device/v1/realtime?sample_rate=16000&codec=pcm16&encoding=binary&pacing=none
```

PCから同じ16 kHz接続先をsmoke testし、2,880,000 byteを欠落なく2.164秒で受信した。
JSON制御イベントは`session.created`、`session.updated`、`response.created`、`response.output_audio.done`、`response.done`の順に届いた。
`codec=opus`などの不正queryはWebSocket Upgrade前にHTTP 400で拒否する。
`sample_rate=8000&encoding=binary&pacing=none&close=done`の外部試験では1,440,000 byteと全制御イベントを受信し、fixtureは`response.done`後にcode 1000で正常終了した。

client の設定値は次の通りである。

```json
{
  "realtimeBaseUrl": "https://stackchan-ai-device.meganetaaan.com/fixture"
}
```

PC から公開 WSS へ接続し、4,320,000 byteを欠落なく1,059チャンクで受信した。
最初と最後の delta 間は89.798秒だった。
チャンク間隔は中央値84.7 ms、p95 146.6 ms、p99 231.9 ms、最大593.5 msだった。
100 ms超は80回、200 ms超は14回だった。
Cloudflare 経路にも burst はあるが、平均帯域を満たし、最大間隔は1秒プリバッファ内だった。

同じ公開 WSS を no-GCM 実機で再生した1回目は、終端時に exact-empty underflow 8回を記録した。
115秒録音のうち、1 kHz音を含む53.94秒の観測窓では、音が83区間に分断された。
有音は合計26.16秒、区間内の無音は82回、合計27.78秒、最大3.28秒だった。
PC側で全量を90秒で受信できた音源が実機では大きく途切れたため、Cloudflare TLS経路で症状が再現したと判定する。
ただし、この結果だけではTLS復号と実機内通知処理のどちらが支配的かは分離できない。

2回目は再生中のJST `23:14:43` に実機のUSBが物理的に切断された。
録音上の音声停止時刻も一致したため、この run は性能比較から除外した。

再接続後の有効な2回目は、90秒音源の `LISTENING` 開始からバッファ排出まで177.369秒を要し、exact-empty は1回だった。
10 ms窓の1 kHz検出では、有音の最初から最後まで175.72秒、検出区間474、検出時間合計93.31秒だった。
区間間の無音は473回、合計82.41秒、最大0.53秒だった。
100 ms以上は347回で合計80.41秒、200 ms以上は289回で合計70.29秒だった。
USBは測定終了まで接続され、録音と内部状態の時間幅も一致した。
exact-empty 1回に対して録音上は短い無音が多数あるため、完全な空読みよりも部分的供給不足または供給停止と再開の反復が支配的である。

## 支持されなかった原因

| 仮説 | 根拠と判定 |
| --- | --- |
| I2S とスピーカー単体 | ローカル PCM 約89.98秒が滑らかだったため支持しない |
| スピーカー音量とクリッピング | 音量0.19の直近録音でクリップ0のため支持しない |
| AEC 単独 | AEC を含まない条件でも頻発したため棄却 |
| PR #634 の Worker 優先度 | timeout と欠落を増やしたため棄却 |
| 固定プリバッファの増量だけ | 2秒を超える通知停止を観測したため棄却 |
| ESP-IDF v6.0.2への更新だけ | 更新後も再現したため支持しない |
| TLS の AES-GCM 復号負荷が支配的 | provider使用を実行時確認した同一音源 A/B で改善しなかったため支持しない |
| USB Audio Dock worker | 起動例外後も対象経路が動作し、因果の証拠がないため別課題 |
| メインスレッドの永久停止 | デバッガ停止時の timeout は測定から除外し、自然な永久停止ログは未確認 |

デバッグ用ホストでは USB Audio Dock worker の起動時に `USB serial driver installation failed` が残っている。
通常リリース版では USB 接続に成功しており、再生途切れとは分けて調べる。

## 残る不確実性

1. 最大約1秒の受信空白を、Cloudflare側の送信、TLS/WebSocket処理、実機のWorker schedulingへ定量的に配分できていない。
2. 16 kHzは3回の初期fixture再生と8月14日の短い通常応答でアンダーラン0だったが、1秒版の長い応答1件では4,096 byteの不足が発生したため、1.25秒版を同等の長い応答で反復する必要がある。
3. 8月13日に利用者が観測した各再起動の直前ログは残っていない。8月14日にはDNS socketのclose後read、TCP受信終了後の古い接続参照、Upgrade要求の書き込み可能量超過を別々に再現したが、過去の全再起動を三経路だけで説明できるとは証明していない。
4. デバッガでmain machineを音声転送中に停止すると、Workerからmainへの`postMessage`がtimeoutしてabortする。通常実行では観測しておらず測定から除外したが、製品上でもmainが同じ長さだけ停止する事象が見つかった場合は別途防御を検討する。
5. 音量を戻した条件で会話は成立したが、24 kHz原音と16 kHz変換音の統制した主観比較は実施していない。
6. UI callbackとWorker通知揺らぎが16 kHz本番経路の余裕へ与える割合は未測定である。
7. アイコン移設と吹き出し非表示はPiuの振る舞い試験を通したが、無人試験のため実画面の目視確認は残る。
8. TCP修正とWebSocket Upgrade修正を含む最終buildでは通常会話の成立と操作改善を利用者が確認したが、利用者発話を含む長時間の反復は未実施である。
9. ACK型backpressureとbinary PCMA上りは単一接続200.583秒で64 KiB上限へ達しなかったが、利用者発話を含む長時間の複数ターンと実際の咳払いによる継続確認は残る。

## 原因切り分け

切り分けでは既存経路から処理を一段ずつ除き、次の順で測定した。

1. ローカルPCMだけをAudioOutへ渡し、I2Sとスピーカー単体を除外した。
2. Cloudflare WSS fixtureをno-GCMとGCMで再生し、AES-GCM復号負荷を除外した。
3. JSON/Base64とbinaryを比較し、転送表現による約34%の増加を確認した。
4. サーバーの実時間ペーシングを外し、受信側backpressureで先行リングを形成した。
5. 24 kHz、16 kHz、8 kHzを同じ本番fixtureとWi-Fiで比較し、必要帯域と実効受信速度の境界を確認した。
6. CPU、メモリ、受信空白、Workerからメインへの遅延、リング残量、AudioOutへの不足を同じrunで採取した。
7. 利用者発話後の停止中に全taskのstackを採取し、mainとRealtime Workerが同じ満杯のnative queueへ投稿していることを確認した。
8. fixtureへ応答後の正常切断を追加し、TCP受信終了時に未読bufferが残る条件で基盤側の再起動を再現した。
9. TCP修正版で実時間ペーシング1回と無ペーシング3回を実行し、再起動の有無を同じ切断条件で比較した。
10. マイクPCMの生成量、ACK時間、main待機列、WebSocket待機列、Worker処理時間を同じrunで測り、1 KiB直列送信の持続速度不足を分離した。
11. 連続PCMを既存待機列内で結合し、native queue停止を再導入せず約16 KiB/sを処理できることをA/Bした。
12. 上りPCMAをbinary frameへ変え、JSON/Base64の転送増加を除いた本番経路で200秒を越える連続入力を確認した。
13. Upgrade要求を意図的に12,370 byteへ増やし、公式`WebSocketClient`の一括送信と分割送信を同じ実機、同じMOD、本番endpointでA/Bした。

イベントごとのtraceは処理を圧迫するため、部分underflowは終端時の集計値だけを出した。
一時計測コードは測定後に削除した。
TCP受信終了とWebSocket Upgradeの修正は、同じModdable 9.0.0基点から独立したupstream候補コミットへ分離した。
stack-chan側の再適用patchと適用scriptは候補コミットから削除した。

## 対応策

修正案に含める対策は次の通りである。

- 出力PCMだけをWebSocket binary frameで送る。
- 通常経路の既定出力をPCM16 mono 16 kHzにする。
- OpenAI Speech APIの24 kHz PCMをstack-chan-ai側でストリーミングresampleする。
- サーバー側の人工的な実時間ペーシングを外し、既存のWebSocketとPCMリングのbackpressureを使う。
- 応答開始前にサンプルレートごとに1.25秒のPCMを蓄える候補を評価する。
- Wi-Fi省電力をstack-chan host側で無効にする。
- 会話を半二重にし、応答再生中は入力処理を止める。
- hostが再生中の呼吸、まばたき、視線を止め、口パクだけを間引いて残す。
- 公式DNS resolverは維持し、socket callbackだけをclose安全な1 packet単位へ直列化する。
- 派生`ChatAudioIO`からRealtime Workerへ送るマイクPCMを一件ずつACKし、待機中の連続領域は同じ一件へ結合する。
- マイクPCMAだけをWebSocket binary frameで送り、通常イベントのJSON text frameと同じ接続上で順序を維持する。
- Cloudflare WebSocket adapterでbinary受信型を`ArrayBuffer`へ固定する。
- stack-chan固有の`ChatAudioIO`を一意なmodule名で選択し、SDK公式実装とのmanifest重複を避ける。
- TCP受信終了時の接続寿命をModdable upstreamで修正し、反映までは候補コミットを含むSDKを使う。
- 公式`WebSocketClient`のUpgrade要求をTLS socketの書き込み可能量ごとに分割する修正をModdable upstreamへ送る。
- control WebSocketの瞬断をRealtime開始条件から分離し、heartbeatの一時的なACK欠落を許容する。
- 前方／後方スワイプで開始／終了を明示し、それぞれ短い確認音を鳴らす。
- 会話状態アイコンをAppBarの表示寿命から分離し、ROBOT LISTENING中は吹き出しを隠す。

互換確認とA/Bのため、`sample_rate=8000|16000|24000`、`codec=pcm16`、`encoding=binary|base64`、`pacing=realtime|none`を接続先queryで選べるようにする。
本番クライアントはqueryがない場合に16 kHz、PCM16、binaryを指定する。
fixtureだけは`close=done`で応答完了後の相手側正常切断も選べる。

次の対策は採用しない。

- PR #634 全体の取り込み。
- Worker の priority または core 固定。
- 2秒以上の固定プリバッファ。
- server が顔モーションを直接制御する設計。
- GCM provider を途切れ対策として必須化すること。
- 8 kHzを通常経路の既定値にすること。
- Opus decoderとencoded frame queueを新設すること。
- Moddable 9.0.0の`WebSocketStream`へ置換すること。

## 2026年8月13日前半の実機状態

対象実機へ PR #650、Moddable 9.0.0、ESP-IDF v6.0.2、no-GCM、counter 付き host を再書込みし、flash hash の検証まで成功した。
host image の SHA-256 は `77bcda47aff37ff22eb9a3b48b50f84232d58cdd722ffe8aa1c92d9101a8c4a8` である。

Cloudflare fixture の no-GCM 基準測定と GCM 2回の測定を実施し、GCM版がネイティブproviderを実行したことも xsdb で確認した。
録音とログは `/home/sskw/stackchan-audio-investigation/2026-08-12-cloudflare-fixture-no-gcm/`、`2026-08-13-cloudflare-fixture-no-gcm/`、`2026-08-13-cloudflare-fixture-gcm/` に保存した。
途中でUSB切断と同時に停止した run は性能比較から除外した。

測定後は GCM なしの host と通常の stack-chan-ai 会話 MOD に戻した。
実機上の設定は本番接続先 `https://stackchan-ai-device.meganetaaan.com`、fixture 用 `realtimeBaseUrl` なし、Preference の実効音量0.19、会話待機状態だった。
家庭内 Wi-Fi、IP取得、stack-chan-ai control WebSocket 接続まで起動ログで確認した。
起動時の USB Audio Dock worker 例外は残るが、main と通常会話 MOD は動作している。

## 2026年8月13日中盤の追加測定と初期候補

対象実機は `/dev/ttyACM0`、USB-JTAGシリアルのMACは `44:1B:F6:E2:82:B0` である。
音量0の設定はfixture経路に反映されず、実際にはスピーカーから音が出た。
利用者が一度電源を切り、再投入後に測定を続行したため、追加測定を無音条件としては扱わない。
取得したログは `/home/sskw/stackchan-audio-investigation/2026-08-13-ttyacm1-root-cause/` に保存した。

### 前回記録からの差分

| 項目 | 前回までの状態 | 追加測定後 |
| --- | --- | --- |
| 対象実機 | 基準条件はMAC `44:1B:F6:E2:99:A4` | 追加測定はMAC `44:1B:F6:E2:82:B0`、`/dev/ttyACM0` |
| バッファ計測 | 完全な空読みだけを数えるexact-empty counter | empty、partial、連続不足回数をWorker受信間隔と同時に計測 |
| 負荷仮説 | TLS復号、CPU負荷、メモリ不足を分離できていなかった | CPU 30–60%、空きメモリ約6.3 MBで飽和を支持せず、GCM A/Bでも改善なし |
| WSS受信 | 録音上の無音と終端時のexact-emptyを中心に評価 | Workerで最大956 msの受信空白を直接観測 |
| 転送方式 | 本番のJSON/Base64経路だけを測定 | バイナリPCM候補を追加し、転送量を約26%削減して全量受信を約80秒まで短縮 |
| ペーシング | サーバーが音声時間に合わせて送信 | 診断用Quick Tunnelとstack-chan-ai候補の通常音声経路で人工的な待ちを解除 |
| プリバッファ | 1秒を採用し、2秒増量は長い停止を吸収できなかった | 診断用5秒では2回とも不足0だが、開始遅延3–5秒のため不採用 |
| 原因判定 | 部分的供給不足を仮説としていた | partialと連続不足を実測し、受信burst、転送表現、供給余裕の組み合わせへ絞り込み |
| fixture | 公開JSON/Base64 fixtureで再現 | この時点では本番URLのコミット`d9caa47`を確認し、binary候補は未デプロイ |
| USB | デバッグ用ホストでUSB serial初期化エラー | 通常リリース版ではUSB接続成功、デバッグ版の競合は別課題として残存 |
| 復旧状態 | counter付き調査ホストと通常会話MOD | リリース版ホストとCodex Voice MODへ戻し、関連serviceとapp-server接続を確認 |

### 観測結果

追加probeのemptyは要求に対する0 byte返却、partialは要求量未満の返却、最大連続は両者が続いた要求回数を表す。
Worker受信時間は計測開始から終端までを表し、最大受信間隔の左値はreadable callback間、右値はPCM decode完了間の最大値を表す。

| 条件 | 受信データ | Worker受信時間 | 最大受信間隔 | 主スレッドの不足 |
| --- | ---: | ---: | ---: | ---: |
| 本番fixture・no-GCM・JSON/Base64 | 5,811,986 bytes | 117.5 s | 667/681 ms | empty 1,362、partial 548、最大連続276 |
| 本番fixture・GCM・JSON/Base64 | 5,811,986 bytes | 113.5 s | 940/956 ms | empty 1,098、partial 393、最大連続133 |
| LAN fixture・JSON/Base64 | 5,926,493 bytes | 90.0 s | 457/631 ms | empty 171、partial 94、最大連続73 |
| Quick Tunnel・バイナリ・人工ペーシングなし・1回目 | 4,320,156 bytes | 79.7 s | 634/669 ms | empty 0、partial 0、最大連続0 |
| Quick Tunnel・バイナリ・人工ペーシングなし・2回目 | 4,320,156 bytes | 80.7 s | 893/916 ms | empty 48、partial 1、最大連続17 |

本番fixtureのJSON/Base64経路では、CPU使用率はおおむね30–60%、空きメモリは約6.3 MBで推移した。
CPUまたはメモリの飽和は観測していない。
バイナリ経路では送信量がJSON/Base64の約74%になり、1回目はアンダーランが消えた。
同一条件の2回目は約0.9秒の受信空白でアンダーランが再発し、バイナリ化だけでは再現性を満たさなかった。

1秒の既存プリバッファを5秒へ広げた診断 run は2回とも不足0だった。
ただし再生開始が約3–5秒遅れたため、ネットワーク停止を隠す対症療法として採用しない。

本番fixtureの公開URLは `wss://stackchan-ai-device.meganetaaan.com/fixture/device/v1/realtime` である。
この時点のデプロイ済みfixtureはコミット`d9caa47`のJSON/Base64実装であり、binary候補はまだ本番へデプロイしていなかった。

### 原因の絞り込み

I2S出力単体のローカルPCM再生は正常であり、主因は音声出力デバイスではない。
実機内のTLS/WebSocket受信には最大約1秒の空白があり、JSON/Base64ではその間にリングバッファを維持できない。
PCMをJSON/Base64で転送すると、Base64の4/3倍化とJSON framingにより、バイナリPCMに対して転送量が約34%増える。
サーバー側は音声を実時間でペーシングして送るため、受信burstの後に最大約1秒の空白が生じると、先行データを十分に蓄えられず受信平均速度と再生速度の余裕が小さくなる。
その結果、PCMリングバッファがアンダーランし、音声の途切れとして観測される。
したがって、主因はCPU・メモリではなく、WSS受信のburstと音声データの転送表現・供給余裕の組み合わせである。

### 最初の実装候補

専用worktree `/home/sskw/ghq/github.com/stack-chan/stack-chan-realtime-audio-fix` に、次の最小候補を残している。

- RealtimeセッションでPCM出力をバイナリフレームとして要求する。
- Moddable側でバイナリフレームをJSON parserへ通さずPCMリングへコピーする。
- stack-chan-ai側でバイナリPCMを送信し、サーバー側の人工的な音声タイムライン待ちを外す。

stack-chan側の候補差分は実装+5/-0行、テスト+10/-2行であり、合計+15/-2行である。
stack-chan-ai側の候補差分は実装+27/-43行、テスト+17/-22行であり、合計+44/-65行である。
候補のファームウェア単体テスト387件、Realtime関連Moddableテスト2件、stack-chan-ai APIテスト8件、型検査は通過した。
この時点のQuick Tunnel測定は2回中1回しかアンダーラン0にならず、binary化とペーシング解除だけでは製品修正の受け入れ条件を満たさなかった。
その後、本番fixtureへデプロイしてrate A/Bを行った結果は「2026年8月13日後半の本番binaryとrate A/B」に記録する。

### Moddable WebSocketStreamの評価

専用worktree `/home/sskw/ghq/github.com/stack-chan/stack-chan-realtime-websocket-stream-eval` で、Moddable 9.0.0の公式`WebSocketStream`を評価した。
評価対象の実装は[Moddable WebSocketStream source](https://github.com/Moddable-OpenSource/moddable/blob/b1f42a2e148f0fc2cd91d7ed1cee56bd361656b2/modules/web/streams/websocket/WebSocketStream.js)で確認できる。
このクラスはreadable側の`desiredSize`とwritable側の`writer.write()`のPromiseによりbackpressureを扱う。
ただし、このbackpressureは受信過多時に読み取りを止める仕組みであり、WSS/TLSからデータが来ない約1秒の空白を埋めるものではない。
現在の`JSONBase64Parser`もPCMリングに空きがないと`Atomics.wait`し、AudioOutがtailを進めると`Atomics.notify`するため、PCM受信側には既にbackpressureがある。

同じ`android-usb-audio` release buildで得たサイズは次の通りである。

| 構成 | `xs_esp32.bin` | binary最小案との差 |
| --- | ---: | ---: |
| 変更前 | 6,158,800 bytes | -112 bytes |
| binary PCM最小案 | 6,158,912 bytes | 基準 |
| 公式Streams manifest追加 | 6,231,136 bytes | +72,224 bytes |

Streams manifest追加時は公式の`web/streams/all`とnative Streams実装もリンクされた。
現在の独自WebSocket worker bytecodeは3,727 bytesであり、仮に全削除できてもStreams追加分を相殺できないうえ、実際にはChatAudioIOとの接続ラッパーが別途必要になる。

fake socketで、最初のwritable callbackより前にreadable callbackを発生させる回帰試験も実施した。
現在のworkerはこのデータを読み取るが、公式`WebSocketStream`は接続stateが0のときreadable callbackから戻り、socketの`read()`を呼ばなかった。
試験結果は期待値1回に対して実測0回であり、後続のwritable callback後にも保持されなかった。
受信音声または最初の`session.created`を失う可能性があるため、リポジトリ内コードの削減だけを理由にModdable 9.0.0の実装へ置換しない。
公式実装がopen前のreadableを保持し、WebSocketだけを小さく取り込める構成になった時点で再評価する。

### binary PCMと通常イベント

WebSocketはtext frameとbinary frameを同じ接続上で順序どおりに混在できる。
候補実装ではサーバーからデバイスへ送るPCMチャンクだけをbinary frameにする。
`session.created`、`session.updated`、ターン交代、transcript、function call、`response.output_audio.done`、`response.done`、errorは従来どおりJSON text frameで送る。
デバイスからサーバーへ送るマイクPCMAもbinary frameとし、旧クライアント用のJSON/Base64入力は互換経路として維持する。
サーバーはbinary PCMAを受信境界で検証してからBase64へ変換し、既存のVADと音声認識gatewayへ渡す。
認証はWebSocket接続時の`Authorization` HTTP headerで行うため、音声frameのbinary化による変更はない。
デバイス側はframeの`binary`属性でPCMとJSONを分岐し、binary PCMをJSON parserへ通さずリングへコピーする。

binary PCM自体には`response_id`や`output_index`を持たせていない。
現在は同時に一つの応答音声だけを順序どおり再生し、終端をJSONイベントで受けるため、独自envelopeを追加しない。
将来、複数種類のbinary payloadを同じ接続で多重化するときにだけtype tagを追加する。

### サンプルレートとcodecの選択肢

現在のstack-chan-aiはOpenAI Speech APIへ`response_format: "pcm"`を指定し、24 kHz PCM16 monoを独自Realtime互換endpointから送っている。
OpenAI Realtime APIのPCM出力も24 kHz固定であり、16 kHzまたは8 kHz PCMを直接指定することはできない。
一方、Speech APIはOpus出力を提供するが、現行のChatAudioIO出力経路にはOpus decoderがなく、CoreS3の`CONFIG_AUDIO_DECODER_OPUS_SUPPORT`も無効である。
形式の制約は[OpenAI Realtime API reference](https://platform.openai.com/docs/api-reference/realtime)と[OpenAI Text to speech](https://developers.openai.com/api/docs/guides/text-to-speech)に基づく。

| 候補 | 転送量 | 固定byteリングが保持できる時間 | 必要な変更 | 判定 |
| --- | ---: | ---: | --- | --- |
| PCM16 24 kHz binary | 48 KB/s | 1倍 | binary frame分岐だけ | 同一Wi-Fiの2回ともアンダーラン |
| PCM16 16 kHz binary | 32 KB/s | 1.5倍 | サーバーresample、rate通知、AudioOut 16 kHz化 | 3回ともアンダーラン0、通常経路の既定候補 |
| PCM16 8 kHz binary | 16 KB/s | 3倍 | 同上 | 2回ともアンダーラン0だが音質未評価 |
| PCMA/PCMU 8 kHz | 8 KB/s | encoded queueなら6倍 | 出力decoderとqueueを追加 | 電話品質が許容される場合だけ |
| Opus | bitrate設定に依存 | encoded queue設計に依存 | decoder、frame queue、CPU・メモリ測定 | 現時点では不採用 |

16 kHz化は転送量を24 kHz PCM比で3分の2にし、同じリングbyte数で保持時間を1.5倍にできる。
ただしstack-chan-ai側で24 kHz PCMを16 kHzへresampleし、セッションのrateとデバイスの`outputSampleRate`を同時に変更する必要がある。
8 kHzやPCMA/PCMUは帯域余裕が大きいが、音声品質とdecoder追加のトレードオフが16 kHzより大きい。
Opusは転送量をさらに下げられる可能性があるものの、device側のdecoderとencoded frame queueを新設するため、現在の最小修正方針には合わない。

いずれの低レート化やcodecも、約0.72秒の受信空白そのものは解消しない。
実測では24 kHzの平均受信速度が再生速度を下回り、16 kHzへ下げた時点で受信空白を含めてもアンダーランが消えた。
8 kHzとOpusは、16 kHzの長時間試験または音質評価で受け入れ条件を満たさない場合に限って検討する。

## 2026年8月13日後半の本番binaryとrate A/B

### 前回記録からの更新

前節までの「binary候補は本番未デプロイ」「24 kHzを先に評価する」という状態から、次の点が変わった。

| 項目 | 前回記録 | 2026年8月13日後半 |
| --- | --- | --- |
| 本番fixture | JSON/Base64実装、binary候補はQuick Tunnelだけ | binary、rate、pacing指定を本番Workerへデプロイ |
| サンプルレート | 24 kHz binaryを最初に評価する段階 | 24 kHz、16 kHz、8 kHzを同じ本番fixtureでA/B |
| 24 kHzの判定 | binary化後も2回中1回で不足 | 同一Wi-Fiの2回とも平均受信速度が48,000 B/s未満でアンダーラン |
| 16 kHzの判定 | 次の候補 | 3回中3回で不足0、通常経路の既定候補 |
| 原因 | burst空白、転送量、ペーシングの組み合わせ | 24 kHzの継続帯域不足を実測し、発生条件を数値化 |
| 通常会話経路 | rate固定、JSON/Base64、実時間ペーシング | 16 kHz既定、binary、ペーシング解除、24 kHzからのresample |
| 通常イベント | JSONのままにする設計 | 実装とテストでもJSON text frameを維持 |
| 実機デプロイ | 調査用hostとfixture MOD | release修正hostと本番クライアントMODを書き込み、Wi-Fiと本番Worker到達を確認 |
| 通常会話の音声 | 未実施 | Device Flow承認後、16 kHz binaryで複数ターン成立、長い応答1件で小規模な不足を観測 |
| USB | debug hostで初期化競合 | 1.25秒版のdebug再確認でも既知の競合が再現し、最終的に競合のないrelease hostへ切替 |

### rate A/Bの測定条件

本番fixtureの90秒1 kHz音源をPCM16 mono、binary、`pacing=none`で配信した。
実機とアクセスポイントは`elecom2g-a4632d`へそろえ、再生音量はprobeで0に固定した。
各rateを2回ずつ測り、16 kHzについてはWi-Fi切替前の1回も判定へ含めた。

`受信速度`はPCMの全byte数をWorkerの開始から終端までの時間で割った値である。
`不足callback`は`emptyDeficits + partialDeficits`であり、AudioOut callbackが要求量を満たせなかった回数を表す。
`再生時間`は最初にAudioOutへ書いた時刻からリング排出までの壁時計時間である。

| rateとrun | PCM | 消費速度 | 受信時間 | 受信速度 | 最大間隔（main/decode） | 再生時間 | 不足callback / deficit byte | 最大リング |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 16 kHz run 1 | 2,880,000 B | 32,000 B/s | 88.685 s | 32,474 B/s | 638/537 ms | 89.986 s | 0 / 0 B | 72,000 B |
| 16 kHz run 2 | 2,880,000 B | 32,000 B/s | 75.296 s | 38,249 B/s | 560/500 ms | 89.986 s | 0 / 0 B | 502,080 B |
| 24 kHz run 1 | 4,320,000 B | 48,000 B/s | 119.583 s | 36,126 B/s | 716/714 ms | 118.872 s | 1,591 / 9,795,264 B | 40,720 B |
| 24 kHz run 2 | 4,320,000 B | 48,000 B/s | 121.990 s | 35,413 B/s | 607/553 ms | 121.260 s | 1,690 / 10,613,000 B | 38,720 B |
| 8 kHz run 1 | 1,440,000 B | 16,000 B/s | 57.420 s | 25,078 B/s | 576/622 ms | 89.729 s | 0 / 0 B | 524,240 B |
| 8 kHz run 2 | 1,440,000 B | 16,000 B/s | 57.181 s | 25,183 B/s | 722/721 ms | 89.730 s | 0 / 0 B | 524,048 B |

24 kHzの2回は90秒分のPCMを受け取るだけで約120秒かかり、再生も同じだけ延びた。
最大リング残量は1秒分の48,000 byteを下回り、受信が再生へ追い付かないまま枯渇した。

16 kHz run 1の受信余裕は474 B/sと小さいが、90秒を88.685秒で受信し、不足は発生しなかった。
run 2では先行データが約502 KBまで増えた。
Wi-Fi切替前の16 kHz runも不足0だったため、16 kHzは合計3回で不足0となった。

8 kHzの絶対受信速度は16 kHzより低い。
これは小さい音声量とframe処理の固定費を含む実効値であり、再生に必要な16,000 B/sは十分に上回った。
リングは約524 KBまで満たされた。

最大受信間隔は不足0の8 kHz run 2でも721–722 msだった。
したがって、「長い受信空白が存在する」だけではアンダーランを説明できない。
1秒プリバッファを超えない空白を耐えるには、空白の前後で平均受信速度が再生速度を上回り、リング残量を回復できることが必要である。

24 kHzの`deficitBytes`を48,000 B/sで割った値は、実際の無音時間ではない。
AudioOutが不足直後に再要求するため、同じ不足期間を複数callbackが重ねて数える場合がある。
ここでは受信に約120秒を要したこと、リングが0になったこと、不足callbackが反復したことを根拠にする。

### CPUとメモリ

同じrunでModdable instrumentsのCPU 0、CPU 1、`System bytes free`を1秒ごとに採取した。

| rateとrun | CPU 0 平均 / p95 | CPU 1 平均 / p95 | 空きシステムメモリ min–max |
| --- | ---: | ---: | ---: |
| 16 kHz run 1 | 33.0% / 36% | 33.9% / 42% | 6,277,671–6,285,091 B |
| 16 kHz run 2 | 27.6% / 38% | 26.7% / 39% | 6,274,227–6,285,155 B |
| 24 kHz run 1 | 26.4% / 33% | 27.1% / 34% | 6,272,467–6,285,191 B |
| 24 kHz run 2 | 24.6% / 29% | 29.3% / 36% | 6,279,751–6,285,339 B |
| 8 kHz run 1 | 27.7% / 37% | 24.0% / 43% | 6,273,047–6,285,547 B |
| 8 kHz run 2 | 16.5% / 35% | 19.0% / 35% | 6,278,067–6,285,311 B |

アンダーランが続いた24 kHzのCPU使用率は、不足0だった16 kHzより高くない。
空きメモリの範囲もrate間で重なる。
CPUまたはメモリ不足を主因とする仮説は、このA/Bでも支持されない。

### 発生機構

観測結果が支持する発生機構は次のとおりである。

1. 実機のWSS/TLS受信は連続流ではなく、最新A/Bで最大約0.72秒、調査全体で最大約1秒の空白を含むburstになる。
2. JSON/Base64はbinary PCMより転送量を約34%増やし、同じ音声時間に必要なnetwork byteを増やす。
3. サーバーが音声時間に合わせて送ると、受信側は空白を吸収する先行PCMを十分に蓄えられない。
4. binaryとペーシング解除で無駄を除いても、24 kHz PCMの48,000 B/sは実機の継続受信速度35–36 kB/sを上回る。
5. リング残量が減り続けて0になり、ChatAudioIOがAudioOutの要求を満たせなくなる。

16 kHzでは必要帯域が32,000 B/sへ下がり、遅いrunでも受信速度がこれを474 B/s上回った。
この差により、fixtureでは同程度のburst空白が残っても1秒プリバッファと先行リングで吸収できた。
通常会話の長い応答では小規模な不足が残ったため、この説明を全応答へ一般化しない。

### 通常会話経路の修正

stack-chan側の修正worktreeは`/home/sskw/ghq/github.com/stack-chan/stack-chan-realtime-audio-fix`である。
接続先queryから`sample_rate=8000|16000|24000`、`codec=pcm16`、`encoding=binary|base64`を読み、AudioOutのrate、1.25秒プリバッファ、parserの最小量を同時に変更する。
binary frameはJSON parserへ渡さず、既存のPCMリングへ直接copyする。
制御イベントは従来どおりJSON parserへ渡す。

stack-chan-ai側では、通常の音声出力をクライアントが要求したrateとencodingへ合わせる。
binary指定時は4,096 byte以下の`Uint8Array`を送り、base64指定時だけ`response.output_audio.delta`を送る。
人工的な音声timeline待ちは削除した。

OpenAI Speech APIの`pcm`出力は24 kHz、16-bit signed little-endianである。
16 kHzまたは8 kHzを要求された場合は、24 kHz PCMを線形補間しながら4,096 byte単位で出力する。
入力chunkがPCM16 sampleの途中で分かれてもcarryを保持し、末尾が奇数byteならエラーにする。
24 kHzから16 kHzへ変換したsample列を、奇数byteのchunk境界をまたぐテストで検証した。

端末クライアントは通常接続先にqueryがなければ`sample_rate=16000&codec=pcm16&encoding=binary`を追加する。
fixtureなどがqueryを持つ場合は、その指定を保持する。
端末能力の`audioOutput`も`audio/pcm;rate=16000`へ変更した。

`session.created`、`session.updated`、ターン交代、transcript、function call、`response.output_audio.done`、`response.done`、errorはJSON text frameのままである。
認証も`Authorization` HTTP headerのままであり、binary化の対象ではない。

### デプロイと実機確認

stack-chan-aiの修正をCloudflare Worker`stackchan-ai-api`へデプロイした。
rate A/B時点のversion IDは`099a2ec3-8043-46f8-82f0-7aa7c7458ae1`である。
相手側正常切断を再現するfixture追加後の最新version IDは`8dd4e0be-3e35-44f7-b28c-ba6ff40aafa8`である。
16 kHz binary、ペーシングなしのfixture smoke testは2,880,000 byteを欠落なく受信した。

修正したstack-chan hostを明示的なrelease modeでビルドし、MAC`44:1B:F6:E2:82:B0`のCoreS3へ書き込んだ。
最初の通常会話後に1.25秒候補もrelease modeで再ビルドし、同じ実機へ書き込んだ。
この時点のbootloader、partition table、6,159,008 byteのhost imageはesptoolのhash検証を通過した。
このhost imageのSHA-256は`a57b7f3deb2abdcaaef76f0fc1fc5885fa5cff0e504be4b3645ecce5e1f3d4d4`である。
続いて正しいhardware IDと本番接続先を持つstack-chan-ai MODを書き込み、MOD archiveもdigest照合を通過した。
fixture試験後に利用者がプロビジョニングと登録を行い、通常会話用の音量を0.15へ戻した。

release起動ログでは`Connected to: elecom2g-a4632d`を確認した。
プロビジョニングと登録後の最初の会話開始では、画面に「AI接続で問題が起きました」と表示され、その後に実機が再起動した。
再起動直前のserial reset reasonと例外スタックは取得できなかった。

Cloudflare tailではJST `2026-08-13 21:47:56`に`Durable Object reset because its code was updated.`を記録した。
同じ時間帯にはcontrol経路`/device/v1/ws`のresponse stream切断とWebSocket 1006も反復していた。
これらは会話開始時の接続エラーを説明し得るが、ESP32の再起動原因を示す直接証拠ではない。

同じWorker versionと端末で再試行すると、会話開始操作から約7.3秒後にRealtime接続が`CONNECTED`へ遷移した。
利用者の発話、応答生成、16 kHz binary PCM再生、次ターンへの復帰が複数回成立した。
観測した主な応答の音声probe集計は次のとおりである。

| 応答 | PCM受信量 | 最大受信間隔 | deficit | empty | 最小リング | 最大リング |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 131,200 B | 692 ms | 0 B | 0 | 128 B | 34,816 B |
| 2 | 164,800 B | 494 ms | 0 B | 0 | 960 B | 33,728 B |
| 3 | 161,600 B | 525 ms | 0 B | 0 | 1,856 B | 44,864 B |
| 4、長い応答 | 409,600 B | 529 ms | 4,096 B | 2 | 0 B | 30,720 B |

4,096 byteは16 kHz PCMの128 ms分に相当するが、AudioOutが直ちに再要求するため、実際の無音時間とは断定しない。
長い応答ではリングが0になり、1秒プリバッファの余裕が十分でない事例を確認した。
その後の短い応答ではdeficit 0へ戻ったため、継続的な枯渇やセッション全体の破綻ではない。

ChatAudioIO確保前の空きシステムメモリは約7.88 MBで、確保後は約6.23 MBだった。
複数ターン中は約6.225–6.227 MBで安定し、単調減少は観測しなかった。
再生中に採取したCPU使用率はCPU 0が約43–60%、CPU 1が約46–84%で、CPU飽和を示す連続100%は観測しなかった。

長い応答の不足を受け、プリバッファ閾値だけを1秒から1.25秒へ変更した。
16 kHzでは開始閾値が32,000 byteから40,000 byteへ増え、追加する開始遅延は250 msである。
1.25秒に達するまで出力しないことをModdable testで確認し、修正候補をdebug hostとして実機へ書き込んだ。
利用者はこの候補でも会話が成立したことを確認した。
ただし、製品候補から一時計測コードを削除済みだったため、この会話の音声probe集計は取得できず、1.25秒版のアンダーラン有無は未判定である。

8月13日終了時点では、1.25秒候補のrelease hostとstack-chan-ai MODが実機上で動作していた。
書き込み後にUSBの再列挙と、MAC`44:1b:f6:e2:82:b0`を持つ`192.168.7.145`からのping応答を確認した。
書き込み対象はbootloader、partition table、factory applicationであり、NVSとMOD用`xs` partitionは消去していない。
Cloudflare tailではrelease再起動後の`/device/v1/ws`再接続を確認し、35秒の観測窓に新しい例外は出なかった。
この短時間観測だけではcontrol接続の長期安定性を判定しない。
`stackchan-codex-voice.service`は競合を避けるためinactiveのままであり、再開していない。
音声は再生できたが、24 kHz原音と16 kHz変換音の統制した主観比較は実施していない。

### release切替後に再発した接続エラー

JST `2026-08-13 22:34`頃、利用者から「AI接続で問題が起きました」の再表示が報告された。
実機`192.168.7.145`は同じMAC`44:1b:f6:e2:82:b0`でpingへ応答し、USB deviceの再列挙時刻も変化していなかった。
今回はエラー表示後の実機再起動を観測していない。

Cloudflare tailは報告直後のJST `22:34:38`から開始した。
その後の観測窓では`/device/v1/realtime`への到達がなく、`/device/v1/config`はJST `22:35:01`以降にHTTP 200を返した。
このため、今回の表示はbinary音声受信より前に発生したか、会話経路とは独立したバックグラウンド設定更新の失敗だったと判断した。

端末実装では、Realtime接続がtoken、agent、conversation IDから独立して開始できるにもかかわらず、control WebSocketの接続中だけ会話開始を許していた。
control WebSocketには過去の観測で1006切断とheartbeat acknowledgement timeoutがあり、瞬断中の前方向スワイプがこの条件に当たるとRealtimeへ接続する前に失敗する。
この不要な開始条件を削除し、controlの再接続中でもRealtime会話を開始できるようにした。

同じ画面文言は、60秒ごとのバックグラウンド設定更新が一度失敗した場合にも表示されていた。
agent設定は端末に保持され、次回更新で回復できるため、この失敗はtraceへ記録するだけに変更した。
Realtime接続自体がFAILEDまたはDISCONNECTEDになった場合の「AI接続で問題が起きました。再接続します」は維持した。

変更後のdevice client test 18件はすべて通った。
本番URL、hardware ID `stackchan:44:1b:f6:e2:82:b0`、音量0.15を検証したmanifestから32,604 byteのMOD archiveを生成した。
MOD用`xs` partition `0xfa0000`への書き込みとdigest照合は成功した。
再起動後の認証付き`/device/v1/config`もHTTP 200へ戻った。
前方向スワイプ後の`/device/v1/realtime`到達はまだ確認していない。

## 2026年8月14日の再起動原因特定と追加要求

### 前回記録からの更新

8月13日末の記録から変わった点は次のとおりである。

| 項目 | 前回記録 | 8月14日の結果 |
| --- | --- | --- |
| 会話開始 | control非依存候補を書き込み、実機確認待ち | 前方スワイプ相当のtouch eventからRealtime接続と16 kHz応答再生まで確認 |
| 再起動 | reset reasonと例外stackがなく原因不明 | DNS UDP socketをcallback中にcloseした後の再readでabortする経路を制御条件で再現 |
| control heartbeat | ACK一回欠落で切断 | 連続3回の欠落まで待ち、openまたはACKでmiss数をreset |
| 1.25秒プリバッファ | 会話成立だけを確認し、probeは欠測 | 通常応答1件で最大受信空白477 ms、deficit 0、empty 0を確認 |
| 利用者発話後の停止 | 入力level、顔、接続処理がまとめて停止 | mainとRealtime Workerが長さ10の同じ満杯queueへ投稿する相互待ちをstackで特定し、マイクPCMを一件ずつACKする方式へ変更 |
| 相手側切断後の再起動 | 直接原因未特定 | TCP受信終了後に遅延した受信量通知が古い接続を参照する経路を再現し、Moddable修正候補と高負荷fixture 4回で検証 |
| 会話操作 | 前方スワイプでtoggle | 前方で開始、後方で終了へ分離し、開始880 Hz、終了440 Hzの確認音を追加 |
| 会話状態表示 | 接続／マイク表示がAppBarとともに隠れる | 既存の表示部品をメイン領域へ移し、AppBar非表示後も表示を維持 |
| ROBOT LISTENING | 直前の吹き出しが残る | `SPEAKING`遷移時に保留字幕を破棄して吹き出しを非表示 |
| release host | 音声修正までを含む6,159,008 byte、SHA-256 `a57b7f3d...` | 出力開始順序版6,163,088 byte、`095722bb...`を経て、TCP修正と空応答修正を統合したbuildは6,165,584 byte、`0d2ea06e...`へ更新 |
| 本番fixture | rate、encoding、pacingを選択可能 | `close=done`を追加し、相手側正常切断の再現と修正後負荷試験に使用 |

### 最初に特定したDNS再起動経路

Realtime endpointを意図的に認証失敗させると、HTTP 401、Workerの`FAILED`、再試行を反復できた。
この失敗だけではabortも再起動も発生しなかった。

同時に独立したcontrol WebSocketを切断して再接続させると、修正前は次の例外でmain machineがabortした。

```text
xsGetHostData: invalid host data (in read)
```

例外はModdableのUDP DNS resolverから発生した。
resolverのreadable callbackはsocketが通知した`count`回だけ`read()`する。
最初のpacketで最後のDNS requestを解決すると、request削除処理がUDP socketをcloseする。
ところがcallbackのローカルな`count`が2以上ならループは継続し、閉じたnative socketをもう一度`read()`する。
このreadが`invalid host data`を投げ、呼出側にcatchがないためabortとハードウェア再起動へ至る。

この構造はModdable 9.0.0だけでなく、8月14日時点の[Moddable public branchのDNS resolver](https://github.com/Moddable-OpenSource/moddable/blob/public/examples/io/udp/dns/dns.js)にも残っていた。
stack-chan側でresolverをforkすると保守差分が大きくなるため、公式resolverはそのまま使う。
代わりに`device.network`の`http`、`https`、`ws`、`wss`が参照するDNS用UDP socketだけを薄くwrapした。

wrapperは`onReadable(count)`を既存callbackへ一回ずつ`onReadable(1)`として渡す。
callback中にsocketがcloseされたら`closed` flagを立て、同じburstの残りを読まない。
fake socketへ`count=2`を通知し、最初のcallbackでcloseした試験ではread回数が1で止まった。
DNS設定は公式の`wssclient/config`後にpreloadし、HTTP/TLS/WebSocketの構成やresolver本体を複製していない。

修正後に同じHTTP 401の反復とcontrol再接続を重ねると、control側ではTLS close/errorから再接続し、Realtime側も複数回失敗して再試行した。
それでもDNS例外、mainの切断、実機再起動は発生しなかった。
停止とGC後はnetwork socket 2、timer 6、空きシステムメモリ7,881,155 byteへ戻った。

8月13日に利用者が観測した再起動直前のstackは保存されていない。
したがって、今回の制御再現で再起動可能な直接原因と修正効果は特定できたが、過去の全再起動がこの一経路だけだったとは断定しない。

### control接続の耐性

control WebSocketとRealtime WebSocketは用途が独立している。
controlの瞬断中でも端末にtoken、agent ID、conversation IDがあればRealtimeを開始できるため、control接続中という開始条件を削除した。

heartbeatはACK待ちを一回検出しただけでは切断せず、連続3回で期限切れにする。
socket openまたは`heartbeat.ack`でmiss数を0へ戻す。
設定の定期更新が一度失敗した場合は、保持済み設定で動作を続けてtraceだけを残す。
Realtime自身が`FAILED`または`DISCONNECTED`になった場合の利用者向けエラーと再試行は維持する。

### デバッガ停止による別の再起動

通常応答の最初の測定では、Workerが音声をmainへ転送中にxsdbでmain machineを数秒停止した。
この操作により`ChatWorker.postMessage`が`receiveAudio`のoffset 144,960 byteでtimeoutし、Workerの未処理例外から実機が再起動した。

これはデバッガが受信先machineを停止したことで人工的に作った条件である。
再試験では音声転送中にmainを停止せず、同じtimeoutも再起動も発生しなかった。
製品経路の結果には含めない。
ただし将来、デバッガなしでもmainが同等時間停止する証拠が得られた場合は、Workerからmainへの通知失敗を会話終了へ変換する防御を別に検討する。

### 16 kHz通常応答の再測定

音量0.18でtouch panelの前方スワイプeventを実機へ注入し、開始音の後に本番Realtimeへ接続した。
接続後に短い応答を要求し、`LISTENING`で16 kHz binary PCMを再生して`SPEAKING`へ戻るまで停止せずに測定した。

| 指標 | 結果 |
| --- | ---: |
| PCM受信message | 6 |
| PCM受信量 | 84,800 byte |
| 最大受信空白 | 477 ms |
| 最大Worker→main遅延 | 0 ms |
| AudioOut callback | 36回 |
| 最大callback間隔 | 129 ms |
| deficit / partial / empty | 0 byte / 0回 / 0回 |
| リング最小 / 最大 | 832 / 37,696 byte |

後方スワイプeventではRealtime Workerが直ちに終了し、その後に終了音を再生した。
終了後はnetwork socket 2、timer 5、空きシステムメモリ7,881,419 byteだった。
メモリの単調減少と再起動は観測していない。

室内マイク録音では開始音を約117.6 ms、主成分882 Hz、終了音を約98 ms、主成分444 Hzとして分離した。
二つの確認音の間には約2.0秒幅の応答音声が記録された。
録音は`/home/sskw/stackchan-audio-investigation/2026-08-14-gesture-ui/clean-start-response-stop.wav`に保存した。

### スワイプ、状態表示、吹き出し

`codex_voice`と同じ方向の割当を使い、前方スワイプを開始、後方スワイプを終了にした。
開始時は既存の`robot.audio.tone()`で880 Hzを80 ms鳴らしてから接続し、終了時は会話資源を閉じてから440 Hzを80 ms鳴らす。
確認音の再生に失敗しても、会話開始または終了自体は継続する。
新しい音源asset、gesture recognizer、audio playerは追加していない。

接続アイコン、接続indicator、マイク入力levelは既存の`ChatStatusBar`部品を再利用した。
FaceView生成時にこの3部品だけをAppBarからメイン領域へ移し、時計とbatteryはAppBarに残す。
AppBarの自動非表示後も接続indicatorがvisibleであることをPiuの振る舞い試験で確認した。

ChatAudioIOの`SPEAKING`は利用者の入力ターン、すなわち画面上のROBOT LISTENINGを表す。
この状態へ入ると保留中の字幕を破棄し、既存の`robot.ui.hideBalloon()`を呼ぶ。
状態遷移自体は実機ログで確認したが、無人試験のためアイコン位置と吹き出しの実画面は撮影していない。

### 応答開始直後に画面と再生が停止する事象

8月14日朝、利用者が会話を始めて話しかけると、状態アイコンを残したまま入力level barと顔の動きが止まった。
表示実装では`LISTENING`に入ると入力level barを隠し、出力用アイコンへ切り替え、再生負荷を抑えるため自律顔モーションを止める。
したがって、報告された見た目はmainの停止だけでなく、応答出力状態への遷移でも発生する。
状態アイコンは同じspriteの別frameを使うため、アイコンが残っていることだけではAudioInの継続を判定できない。

修正前の1.25秒プリバッファは、`response.created`を受けるとPCMの有無にかかわらず`listen`をmainへ送っていた。
Moddable 9.0.0の`ChatAudioIO.listen()`は、その場でAudioInを閉じてAudioOutを開始する。
一方、Workerは40,000 byteのPCMを蓄えるまで`receiveAudio`をmainへ送らないため、AudioOut開始時のring headとtailは同じ位置だった。

この状態のAudioOut writable callbackは0 byteのまま戻る。
状態は`LISTENING`なので、ringが空でも`SPEAKING`へ戻す終端条件には入らない。
AudioOutが空き領域を繰り返し通知するとmainのmessage処理が進まず、Workerが後から送った`receiveAudio`もring headへ反映されない。
先読みのためにPCMを隠したことと、空の出力を先に開始したことが組み合わさり、先読み解除に必要なmessageをmain自身が処理できない状態を作っていた。

この機構は16 kHz binary、`pacing=none`の本番fixtureで決定的に再現した。
修正前は`LISTENING`へ入ってからmainのCPU 0が約80%となり、UI frameとturnが進まず、mainとRealtime Workerのどちらもxsdbの停止要求へ応答しなくなった。
音声をすぐ送る無ペーシングfixtureでも止まったため、この停止はWSSの受信不足やサーバーの生成待ちだけでは説明できない。

[Moddable public branchのChatAudioIO](https://github.com/Moddable-OpenSource/moddable/blob/public/modules/network/services/chatAudioIO/ChatAudioIO.js)も、`listen()`でAudioOutを直ちに開始する点は9.0.0と同じである。
最終修正では`response.created`を字幕などのpresentation更新だけにし、再生状態を変えない。
この生成待ちではChatAudioIOが`SPEAKING`のままAudioInと入力levelを維持するため、level barと顔の自律モーションが進み続ける。

プリバッファが1.25秒へ達した場合は、同じWorkerから`receiveAudio`を先に送り、その後で`listen`を送る。
短い応答が閾値へ達しない場合も、`response.done`で保持PCMと終端silenceを公開してから`listen`と`speak`を送る。
通常イベント、認証、ring buffer、AudioOut本体は変更していない。

`response.created`で出力を開始しないこと、閾値到達時に`receiveAudio`が`listen`より先になること、短い応答でも同じ順序になることを既存のRealtime model testへ追加した。
公式ChatAudioIOには再生状態を変えず入力だけを止める公開APIがないため、公式実装のforkや置換は行わなかった。
この最小修正では、最初のPCMを公開するまでマイク入力も継続する。

途中でstack-chan側の`worker-stack.js`へ`pauseInput()`を追加し、`response.created`から呼ぶ候補も実機へ書き込んだ。
その実機では`pauseInput` messageの処理時に`XS abort: unhandled exception call: not a function`が発生し、Worker timeoutへ至った。
xsdbで`message.id`が`pauseInput`、`typeof this.pauseInput`が`undefined`であることを確認した。
最終生成makefileでは`ChatAudioIO.xsb`の入力がstack-chanの派生実装ではなくModdable SDK公式の`ChatAudioIO.js`を指していた。
この時点では`pauseInput`候補が製品経路で有効にならないうえに例外を増やすため、実装とtestから削除した。

その後のWorker queue停止調査で、この選択はmodule名`ChatAudioIO`が公式manifestと重複した結果であり、派生実装全体が生成対象から外れていたことを確認した。
stack-chan固有のmodule名を`stackchanChatAudioIO`へ分け、製品コードはその一意な名前をimportするようにした。
派生クラスは公式`ChatAudioIO`を継承し、Worker作成とマイクPCMのACK backpressureだけを追加する。
AudioIn、AudioOut、ring buffer、状態遷移は公式実装を維持するため、独自実装の範囲をこの停止に必要な差分へ限定した。

### 出力開始順序の実機測定

順序修正後、16 kHz binary、`pacing=none`の90秒fixtureをdebug hostで3回再生した。
3回ともmainは再生中のxsdb照会へ応答し、終端後に`SPEAKING`へ戻った。

| run | `SPEAKING`から`LISTENING` | `LISTENING`から`SPEAKING` | CPU 0 / CPU 1の観測範囲 | 空きシステムメモリ |
| --- | ---: | ---: | ---: | ---: |
| 1 | 1.914 s | 90.576 s | 23–27% / 26–37% | 6,237,887–6,241,459 B |
| 2 | 0.553 s | 90.640 s | 継続照会でmain応答を確認 | 同じ約6.24 MB帯 |
| 3（最終clean build） | 1.507 s | 90.638 s | 23–26% / 22–28% | 6,236,051–6,241,407 B |

2回目の途中59.6秒を室内DMICで録音すると、1 kHz成分は50 ms窓で一度も閾値を下回らなかった。
録音は`/home/sskw/stackchan-audio-investigation/2026-08-14-playback-start-order/post-fix-unpaced-fixture-dmic.wav`に保存した。
最終clean buildの3回目はUIのturnが95から109まで進み、例外、hard freeze、再起動を観測しなかった。

続いて接続先overrideのないクリーン起動で、認証済み通常会話を試した。
最初の応答は`LISTENING`を5.244秒で排出して`SPEAKING`へ戻った。
短文を直接要求した次の応答は、要求後3分以上にわたってサーバーからPCMが届かなかったが、その間もmainはxsdbの停止要求へ応答した。
PCM到着後は3.956秒の応答を再生し、再び`SPEAKING`へ戻った。

したがって、長い生成待ちと端末のhard freezeは別の事象である。
生成待ちはこの変更だけでは短くならないが、空のAudioOut callbackがmainを占有する停止は同じfixtureと通常接続で再現しなくなった。

### マイクPCM送信queueの相互待ち

出力開始順序を直した後も、利用者が話しかけると入力level、顔、接続処理が同時に止まる事象が再現した。
停止中の全task stackは`/home/sskw/stackchan-audio-investigation/2026-08-14-websocket-write-fix/release-freeze-gdb.txt`に保存した。

main taskはAudioIn callbackから`sendAudio`をRealtime Workerへ投稿する`modMessagePostToMachine()`内で待っていた。
Realtime WorkerもWebSocket書き込み後のsocket通知を自分のmachineへ投稿する同じ関数内で待っていた。
両方のstackが指すFreeRTOS queueは同一で、長さ10の全slotがマイクPCM messageで埋まっていた。
Workerは自分がqueueを消費する前に同じqueueの空きを待つため、待機は自然には解消しない。

修正後は、派生`ChatAudioIO`がnative Workerへ入れる`sendAudio`を一件だけにする。
Workerは音声をWebSocketの送信列へ受理した直後に`audioSent`をmainへ返し、mainは次の一件を投稿する。
待機中のPCMはmain側で最大64 KiBまで保持し、上限を超えた場合は会話を閉じて明示的な失敗へ変換する。
既存のWorkerがACK機能を通知しない場合は従来どおり直接送信するため、派生実装以外の挙動は変えない。

実行試験では、ACK前に二件送ってもnative Workerへ入るのは一件だけで、ACK後に二件目が入ることを確認した。
さらに64 KiBを超える停止を作り、無制限に保持せず`audio worker backpressure`として終了することを確認した。

### TCP受信終了と未読bufferの競合

ACK型backpressureを入れた後、相手側が音声応答の完了直後に接続を閉じると、実機が`tcp_recved()`からpanicして再起動した。
最初のpanic stackは`/home/sskw/stackchan-audio-investigation/2026-08-14-websocket-write-fix/release-production-silence-panic-gdb.txt`に保存した。
TCP終了時点の追加breakpoint記録は`/home/sskw/stackchan-audio-investigation/2026-08-14-websocket-write-fix/release-production-error-origin-gdb.txt`に保存した。

ModdableのTCP受信callbackは相手側終了を`pb == NULL`で受けたとき、readableとwritableだけでなくerror callbackも外していた。
この時点でXS側に未読bufferが残ると、後の`read()`がbuffer解放後の受信量を非同期に`tcp_recved()`へ通知する。
その通知より先にTCP接続構造体が解放されても、error callbackが外れているため所有者のsocket pointerは無効化されない。
遅延した通知は古いpointerを使い、lwIP内部の整合性検査でpanicした。

修正では、相手側終了時にreadable、writable、送信完了のcallbackだけを外し、接続解放を伝えるerror callbackは維持する。
受信量通知は接続pointerの値ではなくpointerへの参照を渡し、先行するnetwork eventの処理後に再確認する。
通知処理は所有者が生存している間に同期して終えるため、接続解放後の遅延callbackも残さない。
新しい`io/socket`経路と従来の`network/socket`経路は同じhelperを使うため、両方の呼出元を更新した。

このModdable差分はbranch`fix/lwip-tcp-receive-lifetime`のコミット`60a320467`へ分離した。
差分は4 sourceの追加22行、削除21行であり、stack-chanのsetup、update、CI cacheへSDK patch処理を追加しない。
競合はnative Cの`tcp_recved()`、tcpip task、PCB解放順序の間で起きるため、JavaScriptのSocket継承では接続寿命を制御できない。
upstream反映前に標準のModdable 9.0.0だけでbuildすると、この接続寿命競合は残る。

### TCP修正後のfixture負荷試験

本番fixtureの`close=done`で相手側正常切断を毎回発生させ、16 kHz PCM binaryを実機へ送った。
実時間ペーシングを一回、無ペーシングの高負荷条件を三回実行した。
四回とも会話Workerは終端し、queue停止、TCP panic、実機再起動を観測しなかった。
無ペーシング中にping応答が一時的に1秒から2秒途切れた回はあったが、USB切断と再起動はなく自動復帰した。
この試験は接続終了と負荷に対する安定性の確認であり、利用者発話を含む通常会話の長時間評価を代替しない。

### 空の音声が再生された事象

サーバーは音声認識結果が空の場合、PCMを生成せず`response.done`だけを返す。
これは無音や誤検出へ音声応答を作らないための意図した分岐である。

実機側はPCMを一件も受けていなくても`response.done`で終端用silenceをringへ追加し、`listen`と`speak`を続けていた。
16 kHzではこのsilenceが8,000 byte、音声時間で250 msとなるため、利用者には空の音声を再生したように見える。
修正後はPCMが0 byteの応答で再生状態へ移らず、現在のマイク入力状態を維持する。
PCMを含む短い応答については、従来どおり保持音声を公開してから再生と排出を行う。
PCMなしで`listen`も`speak`も送らないことをModdable testへ追加し、修正版hostを実機へ書き込んだ。

### 漢字を英語の文字説明として読んだ事象

利用者が聞いた`chinese letter`の反復については、その応答の生成本文、音声合成へ渡した本文、PCM量を記録したログが残っていない。
現在のサーバー実装は会話応答の文字列を変更せず音声合成へ渡し、16 kHz変換は生成後のPCM sampleだけを処理する。
日本語本文がそのまま音声合成へ渡ることは既存testで確認できるが、この一回の発音異常が会話生成本文と音声合成のどちらで生じたかは判定できない。
根拠のない読み仮名変換は追加せず、再現時に既存の出力transcriptとPCM受信量を同じturnで保存して切り分ける。

デバッガから非同期の開始音を待っている途中に会話を直接生成し、停止と再生成を重ねた試験では、Worker終了後にCPU 1が96%となる停止を一度観測した。
この操作は通常のgesture経路と異なり、未完了の開始処理と直接呼び出した開始処理を重ねていた。
実機をクリーン起動し、一つの開始処理だけを通した通常会話では再現しなかったため、製品経路の結果には含めない。

### 最新releaseの書き込み

最初のrelease deployはesptool上は成功したが、生成imageのSHA-256が追加変更前の`a57b7f3d...`と同一で、build logにもXS再生成がなかった。
古い`dist`成果物の再利用と判断し、この書き込みを最終結果から除外した。

`npm run clean`でworktree内の生成物だけを削除し、`npm run build:m5stackchan_cores3 -- --mode=release`で全ソースを新規生成した。
この時点のhost imageは6,163,024 byte、SHA-256は`0077350568927282a35b5bb131854f3ad8fa67c2be3bff1ddadb4103a25fe0c2`だった。
build logには`safe-dns-config`、`safe-readable-socket`、更新した`chat-status-bar`と`face-view`のcompileが含まれた。

このimageをMAC`44:1b:f6:e2:82:b0`のCoreS3へrelease modeで書き込み、esptoolのhash検証を通した。
bootloader、partition table、factory applicationだけを書き換え、NVSとMOD用`xs` partitionは保持した。
hard reset後、約10秒で`192.168.7.145`のping応答へ復帰した。
続けて5秒間隔で10分監視し、pingは120回中120回成功、最大連続offline 0回、`/dev/ttyACM0`の欠落0回だった。
この待機時間はheartbeat周期を複数回含むが、release版ではcontrol socket logを採取していないため、pingとUSBの観測だけを根拠とする。

出力開始順序の最終修正後にもう一度`npm run clean`とreleaseの全buildを実行した。
最終host imageは6,163,088 byte、SHA-256は`095722bb7426e5ebf7555e85171ddff2db09af751242e9efa20eefd83d004faa`である。
`npm run flash:m5stackchan_cores3 -- --mode=release --port /dev/ttyACM0`で同じCoreS3へ書き込み、esptoolのhash検証を通した。
release bootではUSB初期化エラーが出ず、`elecom2g-a4632d`への接続、`192.168.7.145`の取得、アプリ起動、control WebSocket接続を確認した。
書き込み後に5秒間隔で5分監視し、pingは60回中60回成功、最大連続offline 0回、`/dev/ttyACM0`の欠落0回だった。
前段の10分監視は6,163,024 byte版に対する履歴であり、最終imageでは5分監視を新たに実施した。
`stackchan-codex-voice.service`は競合を避けるためinactiveのままである。

TCP受信修正をstack-chanのsetup処理へ統合した後、標準の`/home/sskw/.local/share/moddable`を使ってreleaseを再buildした。
空応答修正を含む最終imageは6,165,584 byte、SHA-256は`0d2ea06e787116cf02414bd07d047a79248621ac9cccf23e3a2f0b58eb792fcf`である。
build logが修正済みSDKの4個のC sourceをcompileしたことを確認した。
この標準build artifactを`/dev/ttyACM0`の同じCoreS3へ書き込み、bootloader、partition table、factory applicationのflash hash検証を通した。
NVSとMOD用`xs` partitionは書き換えていない。
書き込み後の自動monitorだけは実行端末にTTYがないため開始できなかったが、USB再列挙後のserial IDとWi-Fi復帰を別に確認した。
起動直後の最初のpingは3回中1回だったが、その後の10回は10回とも成功した。
負荷試験後は自動会話開始とfixture overrideを外した通常のstack-chan-ai MODへ戻した。

### 咳払い後の切断と終わらない再接続

2026年8月14日、会話開始後の咳払いを契機に「AI接続で問題が起きました。再接続します」と表示され、そのままindicatorだけが回り続ける事象を再現した。
固着中も顔animationとmain event loopは動作し、Wi-Fi pingにも応答した。
release serialには`CONNECTING`が2回出た後、60秒を超えても状態遷移が記録されなかった。
別の観測では`FAILED error=network error`から再試行して再び`CONNECTING`へ入っており、再接続timer自体は作動していた。
JTAGで一度だけ停止するとmain taskはtimer callback内で動作し、`stackchanServer` WorkerはTLSの楕円曲線演算内にいた。
以上から、表示だけの停止ではなく、WebSocketのDNS、TLS、Upgradeを含む接続処理に終了期限がないことを永続待ちの直接原因と判断した。

最初の切断には独立したサーバー側原因があった。
stack-chan-ai APIはtranscription gatewayの`transcript_failed`をすべてsession fatalとして扱い、errorを送ってdevice WebSocketをcode 1011で閉じていた。
[OpenAI Realtime API reference](https://platform.openai.com/docs/api-reference/realtime-server-events/input_audio_buffer/committed?lang=node)では`conversation.item.input_audio_transcription.failed`はitem単位のeventであり、聞き取れない音声には`audio_unintelligible`が例示されている。
咳払いのような非言語音もこのeventになり得るため、session切断へ昇格させる処理は過剰だった。
`audio_unintelligible`だけを音声なしの完了turnとして`response.done`へ収束させ、同じWebSocketで次の入力を受け付けるよう修正した。
認証失敗やgateway障害など、その他のtranscription errorは従来どおりfatalとして再接続させる。

実機側の`ServerChatWebSocketWorker`には30秒の接続timerを追加した。
timerはWebSocket生成前に開始するためDNS、TLS、Upgradeの停止をすべて覆い、最初のreadableまたはwritable通知で解除する。
期限に達した場合は`FAILED`へ遷移して既存の指数backoff再接続へ戻る。
JTAG接続時にmemory protectionがsoft resetを要求し、detach時に発生したpanicは診断操作による別事象なので製品再起動から除外した。

API回帰試験は咳払いerror後にsocketが閉じず、次の音声appendが`speech_started`になることを確認した。
Worker回帰試験は接続成立時のtimer解除と、無通知時のtimeout失敗を確認した。
stack-chan-aiの全69 API testを含む全workspace testとtypecheck、stack-chanの対象Moddable test、lint、formatは通った。
APIはCloudflare Workers version `e8ae3cae-d518-4340-be02-d52f807bb76e`として本番へ反映した。
host imageは6,166,048 byte、SHA-256は`d05daa32e79858a856869fe195ff1bedbd946ece605c8042d285ba4a1f26720b`である。
同じCoreS3へ書き込み、NVSと通常のstack-chan-ai MODを保持したままWi-Fi、IP取得、control WebSocket接続まで確認した。
書き込み直後のpingは10回中9回成功、平均37.5 msであり、1回の欠落だけでは今回のsession切断との因果を示さない。
修正後の実機で咳払いから次の通常発話まで継続できるかは、現在serial監視下で確認中である。

### マイク上りの持続帯域とエラー表示

咳払い修正後の無人連続入力で、音声認識へ送る前のマイク上り経路にも独立した持続帯域不足が見つかった。
8 kHz PCM16のmain側生成量は約16.5 KiB/sであり、入力取得そのものは実時間どおりだった。
一方、native queueの相互待ちを避けるため1 KiBごとにACKを待つ初期実装は、7.097秒で48,128 byteしか処理できず、main待機列が64 KiBへ達した。
ACK 40件時点では経過6.159秒のうちWorker同期処理が5.373秒を占め、WebSocket待機列は0だった。
したがって、この段階の直接原因はnetwork送信量ではなく、小さい音声messageごとにWorker処理を直列化したことだった。

連続した待機PCMを既存messageの`size`へ結合し、native queueへ入るmessageを一件に保つよう変更した。
変更後は7.409秒で116,736 byte、約15.76 KiB/sを処理し、main待機列は3 KiBだった。
main待機列はその後も0へ戻ったが、JSON/Base64のWebSocket待機列が114.7秒で約61.9 KiB、118.310秒で64 KiBへ達した。
このA/Bにより、message直列化を直した後にはJSON/Base64の約34%の転送増加が上り経路の次の律速になることを分離できた。

| 上り構成 | 観測時間 | main側処理量 | 待機列 | 結果 |
| --- | ---: | ---: | ---: | --- |
| 1 KiB ACK、JSON/Base64 | 7.097 s | 48,128 B | main 64 KiB | `audio worker backpressure` |
| 連続PCM結合、JSON/Base64 | 118.310 s | 約16 KiB/s | WebSocket 64 KiB | `websocket backpressure` |
| 連続PCM結合、binary PCMA | 200.583 s | 3,185,664 B | main最大21,504 B、終端1,024 B、WebSocket終端0 B | 接続維持 |

上りbinary実装では、`sendAudioBuffer`だけがPCMA bytesをbinary frameで送り、`sendJSON`はtext frameのまま維持する。
APIはbinary chunkを32 KiB以下に検証し、既存VADと音声認識処理へ渡す境界でBase64へ変換する。
最初の本番version `250b2a19-c6b4-4bd8-9ca9-8f14dae2590c`では、Cloudflare WebSocketの既定受信型`Blob`が`ArrayBuffer`検査に失敗し、`バイナリ入力音声が不正です`で接続を閉じた。
この失敗より前に受信済みの応答音声はPC側で再生されたため、利用者には音声が出ても「AI接続で問題が起きました」の表示が残るように見えた。
共通Cloudflare WebSocket adapterで`binaryType = "arraybuffer"`を指定し、本番version `7d57765f-d1c3-4777-9e34-90501906c4f5`へ更新した。
修正後の1回目は139秒まで安定し、利用者が意図的にUSBを外したため終了した。
再接続後の2回目は200.583秒まで`FAILED`、エラー表示、再接続、64 KiB到達がなく、最大ACK待ち1,344 msの後も待機列を解消した。
室内が静かな無人試験だったため、実際の咳払いから次の通常発話までの確認は残る。

計測用traceと自動会話開始は製品差分から削除した。
製品コードだけのCoreS3 releaseは6,166,048 byte、SHA-256は`95bcc9e56b827e7797c6ecec1a2d71718b6b8f3a48e4b1031d32c1bd11cfb3c7`である。
このimageをMAC`44:1b:f6:e2:82:b0`のCoreS3へ書き込み、bootloader、partition table、factory applicationのflash hash検証を通した。
続けて計測traceと自動会話開始を外した通常MODを`xs` partitionへ書き込み、archiveのflash検証を通した。
通常起動では`elecom2g-a4632d`への接続、`192.168.7.145`の取得、通常MODの起動、control WebSocket接続を確認した。
USB再接続時の本体操作に伴って一度だけ開始と終了のgesture logが続けて出たが、sourceと書き込み済みarchiveに自動開始処理はなく、無操作30秒では再発しなかった。
診断用esptoolの既定resetで一時的にROM bootloaderへ入った後は、ESP32-S3用watchdog resetで通常起動へ戻し、ping 10回中10回の応答を確認した。
この再列挙でdevice nodeは`/dev/ttyACM1`になったが、by-idとMACは同じ実機を示している。

### WebSocket Upgradeの送信backpressure

上りbinary修正後も、本番Realtime接続が`network error`またはtimeoutになり、Cloudflare WorkerへUpgrade要求が到達しない試行が残った。
同じPCから本番routeへ接続すると未認証要求へ直ちにHTTP 401が返り、実機から同じhostのfixtureへは接続できたため、route不在とTLS接続先全体の障害は除外した。
control WebSocket、fixture、実際の`Authorization` headerを組み合わせた接続も成立し、headerの有無だけでは失敗を説明できなかった。

Moddable 9.0.0の公式`WebSocketClient`は、TLS handshake後の`onWritable(count)`で受け取った容量を保持していたが、Upgrade要求の送信時には`count`を使わず要求全体を一度に`write()`していた。
直下のTLS socketは現在の書き込み可能量をLwIP socketへ渡し、LwIP socketはその容量を超える書き込みを拒否する。
したがって、TLS handshake直後の空きがUpgrade要求より小さい試行だけがWorker到達前に失敗するため、同じ設定でも成功と失敗が混在した。

この条件を確実に作るため、診断中だけ`Authorization`値の末尾へHTTPで許容される空白を加え、Upgrade要求を12,370 byteへ増やした。
修正済みhostでは書き込み可能量が5,648 byte、2,771 byte、2,771 byte、残り1,180 byteの順になり、4回の送信後に`CONNECTED`へ遷移した。
本番Workerも同じRealtime routeのUpgradeを受理した。

次にMODとnetwork条件を変えず、hostだけを旧imageへ戻した。
旧imageはUpgrade中に`CONNECTED`へ到達せず、control WebSocket error、Wi-Fi再接続、`RTC_SW_CPU_RST`を記録して再起動した。
修正済みimageへ戻すと同じ12,370 byteの要求で接続したため、送信分割の有無だけが結果を分けた。

回帰試験は公式`WebSocketClient`を64 byteずつしか受理しないfake socketへ接続し、要求末尾の`\r\n\r\n`まで複数回で送ることを検証する。
修正を外したnegative controlでは最初の一括`write()`が`would block`を投げ、修正適用後は同じ試験が通った。
診断用の長いheader、自動会話開始、強制mute、分割量traceはA/B後に削除した。

upstream候補はbranch`fix/websocket-handshake-backpressure`のコミット`07361c0c5`である。
実装は追加16行、削除3行、`testmc`の試験と登録は追加51行であり、64 byte制限のシミュレータA/BとESP32-S3向け`testmc` buildを通した。
`WebSocketClient`のprivate stateをSocket派生クラスから変更できないため、Socket継承による回避実装は採用しない。
TLS Socket wrapperで書き込みを再分割する方法は実装可能だが、保留buffer、close、error、writable通知を二重管理するため、公式クライアント内の修正よりコードと故障点が増える。

診断traceを除いた最終host imageは6,166,336 byte、SHA-256は`6e01bed223e90b383d783a3af5a741b536473405f98fb76e7763052e83e3114a`である。
`npm run clean`後の全buildで公式WebSocketClientのbytecodeを再生成し、同じCoreS3へ書き込んでflash hash検証を通した。
通常MODも本番endpoint、音量18%、自動開始なしへ戻し、Wi-Fi、IP取得、アプリ起動、control WebSocket接続を確認した。
書き込み直後の無操作観測では60秒を超えて再起動しなかったが、この最終構成で利用者発話を含む通常会話を反復する確認は残る。

### 会話タイミングチャート

[Realtime音声会話タイミングチャート](./realtime-conversation-timing-chart.html)に、接続、5秒の利用者発話、700 msの終話判定、応答準備、応答再生、マイク復帰を分けて示した。
接続時間と応答準備時間は通常会話で未計測のため入力欄で変更でき、既定値は説明用の仮置きである。
5.244秒の応答再生、700 msの終話判定、約500 msのマイク復帰は実測値または実装値である。
今回のqueue停止とTCP受信終了は正常な時間軸の途中または末尾で処理が止まる不具合であり、正常系のphase定義は変えない。

### テストと差分量

stack-chanではNode.js unit test 388件がすべて通った。
Realtime model、WebSocket worker、`chat-status-bar`、`face-view-state`のModdable test manifest 4件も通った。
`npm run lint`と`npm run format`はexit 0だった。
lintには既存fakeの空constructorに関するinfoが1件あるが、今回の変更箇所ではない。

stack-chan-aiでは`pnpm test`が通った。
内訳はdomain 6件、memory-contract 3件、web 44件、executor 18件、memory 2件、API 69件、device client 19件であり、fixture self-testも通った。
memory integrationの2件は既存設定どおりskipである。
`pnpm typecheck`も全workspaceで通った。

最終コード差分は次のとおりである。

| リポジトリと区分 | 追加 | 削除 | 変更行合計 |
| --- | ---: | ---: | ---: |
| stack-chan 実装 | 237 | 20 | 257 |
| stack-chan テスト | 211 | 7 | 218 |
| stack-chan-ai 実装 | 265 | 79 | 344 |
| stack-chan-ai テスト | 120 | 50 | 170 |
| Moddable 実装 | 38 | 24 | 62 |
| Moddable テストと登録 | 51 | 0 | 51 |
| 実装合計 | 540 | 123 | 663 |
| テスト合計 | 382 | 57 | 439 |
| 全体 | 922 | 180 | 1,102 |

前回記録の追加319行、削除106行は音声binary化とrate A/Bまでの差分である。
その後、DNS再起動修正、control耐性、スワイプ、吹き出し、UI移設が追加要求になった。
追加要求を合算した最初の予算は追加391行、削除147行だったが、既存差分との足し算を誤っており、監査時点で変更行合計を68行超えていた。
残りのコード編集前に、実装を追加330／削除90行、テストを追加180／削除60行、全体を追加510／削除150行、最大660行へ訂正した。
応答開始停止の調査で前回文書から実装+4/-2行、テスト+9/-0行が増え、変更行合計は15行増えた。
不採用の`pauseInput`候補を削除する直前に、実装+0/-9行、テスト+0/-1行、合計10行削除という予算へ更新し、実績も同じだった。
その後にnative Worker queueの相互待ちとModdable TCP接続寿命の問題を新たに特定し、旧上限を設定した時点にはなかった根本修正と回帰試験が必要になった。
この追加調査では、本番fixtureの正常切断指定を追加16／削除7行、実験設定の撤去を追加0／削除10行、SDK修正の再現可能な統合を追加95／削除6行の個別上限で管理した。
SDK patchのstack-chan内統合は後に撤去し、Moddable側の独立コミットへ移した。
空応答修正は実装を追加6／削除0行、テストを追加16／削除0行、合計22行の上限とし、実績は実装追加4行、テスト追加10行だった。
咳払い切断と接続永続待ちの修正は実装を追加20〜32／削除0〜4行、テストを追加25〜38／削除0〜2行、最大76行と見積もり、実績は実装追加25／削除1行、テスト追加38／削除2行の計66行だった。
その後のPCM結合は実装追加3／削除1行、テスト追加3／削除1行の上限8行に対して実績8行だった。
上りbinary PCMAは追加予算42行に対して実績42行、Cloudflare受信型修正は追加予算3行に対して実績3行だった。
新たに特定した三修正の変更行合計は53行であり、咳払い修正からの更新予算119行と実績119行は一致した。
stack-chan内のModdable patch統合撤去は、実装追加0〜2／削除113〜120行、テスト追加0／削除45〜60行、最大182行と見積もった。
実績は実装追加1／削除117行、テスト追加0／削除48行の計166行であり、上限を超えていない。
WebSocket Upgradeのupstream候補は、実装追加14〜18／削除2〜4行、テスト追加35〜55／削除0行、最大77行と見積もった。
実績は実装追加16／削除3行、テストと登録追加51／削除0行の計70行であり、上限を超えていない。
TCP接続寿命のupstream候補は、実装追加24〜30／削除18〜25行、テスト追加0／削除0行、最大55行と見積もった。
実績は実装追加22／削除21行の計43行であり、追加行は見積もり下限より2行少なく、上限を超えていない。
全体の追加922行は旧上限510行を412行超え、削除180行は旧上限150行を30行超えた。
超過は旧上限の後に実機計測で特定したnative queue相互待ち、TCP接続寿命、咳払い切断、上り持続帯域、Upgrade送信容量超過の根本修正と回帰試験による。
生成物、調査文書、一時instrumentationは集計に含めていない。

### 証跡

最新A/Bのraw xsdb logとinstruments JSONLは`/home/sskw/stackchan-audio-investigation/2026-08-13-production-binary-rate-ab/`に保存した。
認証済み通常会話で転記したprobe集計と1.25秒版の欠測記録は`/home/sskw/stackchan-audio-investigation/2026-08-13-production-conversation/observed-audio-probe.jsonl`に保存した。
8月14日の開始音、通常応答、終了音を含む録音は`/home/sskw/stackchan-audio-investigation/2026-08-14-gesture-ui/clean-start-response-stop.wav`に保存した。
同じディレクトリの`start-response-stop.wav`は、デバッガ停止によるWorker timeoutと人工的な再起動を含むため、製品音声の性能比較には使わない。
Worker queue停止の全task stackとTCP受信終了のpanic stackは`/home/sskw/stackchan-audio-investigation/2026-08-14-websocket-write-fix/`に保存した。
一時instrumentationは製品差分から削除した。
ModdableのTCP修正は`60a320467`、WebSocket修正は`07361c0c5`として、同じ9.0.0基点の独立branchへ記録した。

### USB初期化エラーとの関係

debugまたはinstrument hostではUSB Serial/JTAG debuggerとUSB Audio Dockが同じinterfaceを使うため、`USB serial driver installation failed (in nativeConstruct)`が記録される。
修正worktreeの基点にはUSB Dockを必要時だけ開始する`945df491`（`feat: align USB dock voice lifecycle`）がすでに含まれる。
`fix/usb-debugger-conflict`の`c3efcbf5`と`7744c5d1`は通常コマンドをreleaseへ寄せて警告とテストを追加する変更であり、debuggerとUSBを同時利用できるようにする変更ではない。
今回は`--mode=release`を明示したため、この2コミットをcherry-pickしていない。
release起動ではUSB初期化エラーが出ず、`CoreS3 USB接続: maxPayload=4096 event=true status=true statusExtended=true`を確認した。
現在の最終版はrelease hostであるため、USB Serial/JTAG debuggerとの既知の競合はない。
USBの再列挙、Wi-Fi接続、control WebSocket接続、Wi-Fi上のping応答まで確認した。
`stackchan-codex-voice.service`はstack-chan-ai MODとの競合を避けるためinactiveのままである。

## 関連 pull request

- stack-chan PR #634: <https://github.com/stack-chan/stack-chan/pull/634>
- stack-chan PR #650: <https://github.com/stack-chan/stack-chan/pull/650>
- stack-chan-ai PR #1: <https://github.com/meganetaaan/stack-chan-ai/pull/1>
- stack-chan-ai PR #2: <https://github.com/meganetaaan/stack-chan-ai/pull/2>
- Moddable GCM provider: <https://github.com/meganetaaan/moddable/tree/feat/esp32-tls-gcm-provider>
- Moddable TCP upstream候補: local branch`fix/lwip-tcp-receive-lifetime`、commit`60a320467`
- Moddable WebSocket upstream候補: local branch`fix/websocket-handshake-backpressure`、commit`07361c0c5`

## 証跡と未解決事項

再起動前の録音、波形、スペクトログラムは `/tmp` から消失したため、本書には解析済みの数値だけを記録した。
Cloudflare fixture の再測定以降は録音とログを `/home/sskw/stackchan-audio-investigation/` に保存した。

- 書き込み済みの標準release版で利用者発話を含む長い通常会話を反復し、deficit、empty、最小リング、ACK待機列、再起動の有無を回収する。
- 16 kHzを異なる時間帯と長い会話で反復し、遅いrunでも32,000 B/sを継続して上回るか確認する。
- 24 kHz原音と16 kHz変換音を同じ音声と音量で比較し、resample品質を評価する。
- release版を長時間動かし、control再接続、Realtime失敗、相手側正常切断が重なってもDNS例外、TCP panic、再起動が再発しないことを確認する。
- DNS resolverのcallback中closeを最小再現とともにModdable upstreamへ報告するか検討する。
- TCP受信終了とWebSocket Upgradeの候補branchをforkへpushし、独立したModdable PRとして提出する。
- WSS受信空白をCloudflare送信、TLS/WebSocket処理、Worker schedulingへ分離する。
- PR #650で再生中の自律顔モーション停止と口パク維持を目視確認する。
- AppBar自動非表示後の接続／マイク表示と、ROBOT LISTENING中の吹き出し非表示を実画面で確認する。
- 通常会話の接続時間とVAD後の応答準備時間を計測し、タイミングチャートの仮置き値を実測値へ置き換える。
- 最初のPCM公開までは公式ChatAudioIOのマイク入力が継続するため、長い生成待ちでechoやVADの余分なturnが発生しないか通常会話で確認する。
- 上記の余分なturnを再現した場合に限り、公式実装をforkせずに入力を止められる状態設計を検討する。
- 必要ならESP-IDF v6.0.0からv6.0.2の省電力挙動の回帰点を特定する。
- debug hostでUSB Audio Dockを同時利用する必要が生じた場合だけ、USB Serial/JTAGとの所有競合を別課題として扱う。
