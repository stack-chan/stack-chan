# Firmware SDK 再設計の実装・検証台帳

起点は `origin/feat/moddable-9.5` の `6eb462331dd1677791d6aa2a6b257a20da43b9a9`。
作業ブランチは `codex/firmware-sdk-redesign`。調査資料は [2026-09-05 のレビュー](reviews/2026-09-05-firmware-redesign/README.md)。

この台帳は完了宣言ではない。各項目は、実装とその契約を検証する証拠が揃うまで未完了とする。

| 課題 | 必要な最終状態 | 状態・検証先 |
| --- | --- | --- |
| F1 公開境界 | V2 の SDK は旧 flat API、具体的 TTS・sensor・Piu controller を含まない。高度な拡張を別入口にする | 基本SDK・motion・一枚撮影と画像表示をAppSessionへ接続。録音・会話・設定・高度な拡張は未完了 |
| F2 寿命 | Host / App / Operation の所有を接続。開始失敗の rollback、取消し、一度だけの完了、終了後のコールバック抑止 | composeとcontextのrollback、UI・入力・カメラ、サーボUART、共有PY32の終了とmotion置換時の世代管理を接続。BootSession、Wi-Fi使用権、ローカル通信と起動失敗画面の終了を接続。WASMカメラとnativeのフレーム待ち、native / WASM録音のrollback・取消し・期限・解放待ちも接続。AppSessionの音声所有とnative TTSなどは継続 |
| F3 操作契約 | 完了・エラー・未対応・時間・単位・入力検証を統一。say と素材再生を分離。motion の指令受付と到達を区別 | V2のspeech/clip、motionの度・ms・measured/estimated・期限・取消し、native / WASM録音の完了・時間とバッファ上限・形式の保持を接続。他機能と実機での確認は未完了 |
| F4 競合と重複 | 音声、会話、USB、motion、物理 UART の資源管理を共通化。上限・期限・取消しを保証 | 通常音声とV2 motionに停止待ち付きOperationQueue、サーボUARTに共通FIFOを接続。注視と単発移動を調停。Wi-Fi接続に所有者別の使用権、一枚撮影に待機2件の停止待ちキューを接続。会話・USB・全無線経路の調停・V1移行は未完了 |
| F5 教材適合 | 全 MOD／miniapp の入口を分類・移行。公開契約に適合し、機種差の回避策を基盤へ移す | JavaScriptの6教材とSDK型検査を追加。全32旧MOD／miniappの入口と依存を宣言。SDK世代2への移行は未完了 |
| F6 アプリ構成 | 既定動作、診断、UI 拡張の責務と寿命を分ける。既定動作にも SDK と AppSession を使用 | 最小起動入口と保守起動を分離。既定動作のSDK化・診断とUI拡張の分離は未完了 |
| F7 正本 | 共通 manifest、ボード設定、公開型と module exports の正本を統一。target 別の型検査を成立させる | 共通 host runtime、TTS契約、設定定義とモデル用manifestを一本化。Webも同じ設定定義を参照。ESP32のMAC取得ソース選択も修正。ボード・残りの公開型・型検査は未完了 |
| F8 設定・起動 | 型・検証・優先順位・secret・適用時点を共通設定サービスへ集約。オフライン教材を Wi-Fi 待機から独立 | V2起動をWi-Fi待機から独立。SettingsServiceを設定画面・BLE・設定読み込みへ接続し、Wi-Fi起動の優先順位を統一。BootSessionの準備状態・期限・取消し・置換時の終了を接続。アプリ公開API・V1起動全体の整理・電源断時の保証は未完了 |
| F9 WASM | native / simulated / unsupported を明示。無音・未実行の成功をなくす。教材の状態遷移を共通検証 | TTSの失敗・取消し、motionの構造化bridgeと推定完了、WASMの経過時計を接続。Wi-Fi管理器を共通化し、WASMのWi-Fiをunavailableと明示。カメラの所有・取消しを接続し、明示されていない合成画像への代替を廃止。その他の能力metadataと教材適合は未完了 |
| F10 検査・配布 | 公開依存・JS / TS 教材・型・ライフサイクルを実効的に検査。V2 metadata を Web / CLI / SD / WASM で起動前検証 | SDKのAST依存検査と全新教材のstrict検査を追加。全32例と6教材に宣言を同梱。Web・CLI・SD・WASM・起動時に必須検査と拒否時の復旧を接続。Gallery配布物と外部宣言も照合。実際の能力表・SDK移行・全ビルド入口・実機受入は未完了 |

## 固定する設計判断

- Moddable 9.5 / XS、Piu、C / Worker、高頻度処理の再利用バッファは維持する。
- V1 の互換性と V2 の公開契約を別世代で扱う。V2 の契約変更を旧 MOD に暗黙適用しない。
- 操作の成功は定義した完了、失敗・取消しは理由を持つ Error。公開時間引数は ms、角度は名前で単位を示す。
- 資源は取得直後に所有者へ登録し、終了時に逆順で解放する。任意の JavaScript の強制中断は保証しない。
- 音声や動作の待ち行列を無制限にしない。競合・置換・期限はサービスの契約とする。
- ビルドは既存の npm / Moddable wrappers を使い、独自 manifest 処理系を作らない。
- 教材、Blockly、Gallery、ローカル導入を同じ SDK 世代へ接続する。

## 完了の監査

- [ ] F1〜F10 の各最終状態を実装と試験へ対応付ける。
- [ ] 寿命を100回繰り返し、Timer / 購読 / lease が毎回基準へ戻る。
- [ ] 開始途中の失敗、進行中の close、遅延 callback、二重 close を検証する。
- [ ] say + tone、radio + say、会話 + 録音、注視 + 単発移動の競合を検証する。
- [ ] motion の 0ms / 不正値 / 範囲外 / timeout / cancel / measured と estimated を検証する。
- [ ] Node、XS、公開 SDK と教材の型、依存境界、manifest、Web の検査を実行する。
- [ ] CoreS3、WASM、PWM を含む対象のビルドと教材の受入動作を検証する。
- [ ] 実機の電源・音声・可動域・遅延・メモリーの証拠を取得し、未検証をビルド成功で代用しない。
- [ ] 初学者向け導線、移行手順、API 文書、release impact と changeset を更新する。

## 作業記録

- 2026-09-06: 最新 remote refs を確認し、Moddable 9.5 対応ブランチから独立 worktree を作成。調査資料を取り込み、依存関係を導入した。
- 初期基準: Node テスト410件成功。SDK 9.5.0 の未改変ソースから Linux ツールを別ディレクトリーに構築した。
- 最初の実装: ResourceScope の逆順解放と再入可能な close、OperationQueue の上限・待機期限・実行期限・取消し、TTS / Speaker の共有終了処理、PWM の即時指定と有限値検証を追加した。
- 検証: Node テスト428件、構成検査78件が成功。XS の全47 manifest を実行し、共有 test helper の型による3件の失敗を修正して対象3件の再実行が成功した。新しい XS 寿命試験は資源と期限 timer の100回の開始・終了を検証する。
- XS 試験で、凍結された `Error.prototype.name` へ代入できない点を検出し、`StackchanError` の生成を修正した。Node の成功だけでは XS 適合を証明できない実例として、両環境での検査を維持する。

## 次に接続するもの

1. V2の基本SDK・motion・AppSessionは接続済み。録音・会話・設定の公開サービスと拡張を実装し、既存MOD／miniappへ移行する。
2. composeの取得直後の登録とcontextのrollbackは接続済み。サーボの共有UARTとPY32 expanderの終了は接続済み。BootSessionとWi-Fi使用権・ローカル通信を終了経路へ接続済み。WASMカメラの下位資源とnative / WASM録音の寿命も接続済み。AppSessionの音声所有とnative TTSへ接続を進める。V1の直接参照と機器置換の寿命も継続して扱う。
3. 音声出力の個別取消しはAppSessionへ接続済み。音声入力と出力、WASM bridgeのclose、会話とUSBの資源を調停する。
4. motion controllerのドライバー交換にcallbackの世代管理を接続した。native TTSの出力、AppSessionの使用権、V1の直接参照へも接続を進める。共通キューは非同期停止の確認を待ち、解放失敗後に後続操作を開始しない。
5. 最小教材から残りの F1〜F10、配布・移行・実機受入まで続ける。現時点では全課題を解消した状態ではない。

## V2 基本SDKの接続（2026-09-06）

- `firmware/sdk` に基本AppContext、defineApp、CancellationSignalを追加。host内のTaskScopeとAppSessionがアプリ終了時に入力・周期処理・音声操作を閉じる。V1との混合を型検査で禁止した。
- Node 439件、構成検査80件、6ターゲットのmanifest検査が成功。XSの100回AppSession試験と、Piuを含む実ホストcontextでの取消し・raw入力復元試験が成功した。
- Linuxホストのビルドが成功。4つの新規JavaScript教材はstrict型検査が成功。この段階では実機・ブラウザー受入は未実施（後述のWASM受入でブラウザーは確認済み）。
- 共通manifestからmainを切り離した。起動入口はnative / WASM rootが選び、試験から共通ランタイムを再利用できる。native依存もmanifest_nativeにまとめた。
- ESP-IDF 6.1と必要ツールを別ディレクトリーへ導入。CoreS3リリースビルド（6,415,984 bytes）と全48 XS試験が成功。Host descriptorのAPI世代は既存値1のままで、V2配布metadataとともに更新する作業が未完了。

- WASMブラウザー受入で、入力 → SDK → プロバイダーの同期呼び出しがXSのスタック上限へ達する不具合を検出した。TaskScopeの開始をmicrotaskへ移し、実行直前にも終了状態を再検査する。取消し前に予約された処理が終了後に開始しないことをNode試験へ追加した。
- 修正後、発話教材がChromium上で非空の音声バッファを生成し、Web Audioの再生開始まで到達した。ブラウザー受入は `web/simulator/sdk-lessons-visual.mjs` に再現手順として残した。実際のスピーカーの音量・音質は未検証。
- Webの既存Node試験208件、React試験51件とWebビルドが成功した。V2教材4件のMOD archive生成とWASMビルドも成功した。

- 最終確認: 4教材すべてをChromiumのWASMシミュレーターへ順に読み込み、起動・tone・主入力・発話のWeb Audio開始が成功した。追加修正後もNode 439件、構成検査80件、SDK strict検査、対象2 XS試験とCoreS3 / WASMビルドが成功。全48 XS試験はSDK接続時に成功し、その後変更した寿命部分は対象2試験で再確認した。

再現コマンド（SDK 9.5.0の環境を読み込んだ `firmware` から）:

```sh
npm run check:sdk
npm run test:unit
npm run check:architecture
npm run check:manifest
npm run test:moddable
npm run build:release:m5stackchan_cores3
npm run build:release:takao_core2_sg90
npm run build:wasm
npm run mod:build -- lessons/01-face/manifest.json
npm run mod:build -- lessons/02-tone/manifest.json
npm run mod:build -- lessons/03-input/manifest.json
npm run mod:build -- lessons/04-speech/manifest.json
npm run mod:build -- lessons/05-motion/manifest.json
```

Web側は `web` から `npm test` と `npm run test:sdk-lessons`。Chromiumが既定の場所にない環境では `CHROMIUM_PATH` に実行ファイルを指定する。実機の電源・音質・可動域の受入は未検証のままである。


## 起動失敗の回収とUI・入力の終了（2026-09-06）

- `RuntimeResources` を導入し、composeが返り値を受け取った機器を直ちにサービス別の子スコープへ登録する。`StackchanRuntimeContext.create()` は初期化と失敗時の回収を一つの非同期処理にまとめた。runtimeからのcloseとcomposeのrollbackは同じ子スコープを閉じ、登録済み機器を二重に解放しない。
- 入力のrawボタンの復元、音声の購読解除、UIの吹き出し・drawer・miniapp・Piu viewの終了を接続した。入力・音声・UI・照明・カメラのruntime closeは同じ完了Promiseを返す。Dockはmainのスコープが所有し、context生成失敗後のcatchでも重ねてcloseしない。
- カメラの進行中のcapture/startはcloseで失敗として完了し、後から返る画像は破棄する。停止失敗時にもnative入力と画像を解放し、タッチ入力を再開しない。非同期操作は15秒、終了時のstopは2秒で打ち切り、後続の解放を試みる。下位ドライバーの任意のclose自体を強制終了する契約ではない。
- Touch / TouchPanel / IMUの終了を一度に限定し、終了後のイベントと再起動を抑止した。Touch・IMUでドライバー取得後に初期化が失敗した場合も、その入力を解放する。NeoPixelの出力closeとPY32 LEDのeffect timer停止も接続した。PY32の共有expanderをLED単独で閉じることはしない。
- XSで、サーボattach・TTSのイベント登録・入力start・能力情報の構築の4段階に失敗を注入した。元のエラーを保持し、非同期の解放が終わってからrejectし、rawボタンの復元・Piu viewの除去・顔更新停止を確認した。カメラと入力の下位ライフサイクル試験も追加した。
- 顔UIの単体試験でXSのスタック上限に達したため、エラー時だけ必要なローカル変数を構築の成功経路から切り離した。同じstack設定で再実行が成功した。単体UIテストからも資源管理を読み込めるよう、`manifest_resources.json`を共通化した。
- 検証済み: Node 446件、構成検査80件、SDK strict検査、6機種のmanifest検査、全50 XS manifestが成功。最後に追加したUIのeffect除去失敗の試験も、対象のcontext-lifecycle manifestで成功した。
- CoreS3のreleaseビルドは6,432,368 bytes、PWM機種 `takao_core2_sg90` は3,734,928 bytesで成功し、各app partitionに収まる。WASMビルドも成功した。Host descriptorのAPI世代は依然 `9.5.0+stackchan.1` であり、V2 metadata配布は未完了。
- WASMでホスト起動からUI構築までの呼び出しが重なる場合にもスタック不足を検出した。非同期のcompose入口で呼び出し元が戻るのを待ってから機器を生成するよう変更し、全4教材のブラウザー受入が成功した。これはSDKの操作開始をmicrotaskへ移した前段の変更とは別の、ホスト構築の修正である。
- この変更後もCoreS3 / PWM / WASMのビルドと対象XS試験を再実行した。実機での電源・入力・音声・サーボ動作の受入は未実施。

この段階でもF1〜F10の解消は未完了。特にSCServo / DYNAMIXEL / RS30XのUART・ID登録の解放、共有expanderの寿命、boot servicesの取消し、WASMカメラのpoll/ブラウザー開始要求の取消し、native TTSエンジンの明示解放、各種置換とV1の直接参照を扱う作業が残る。登録スコープのテスト成功を、これら未接続の物理資源の回収成功とは見なさない。


## サーボUARTの共通化（2026-09-06）

- SCServo / DYNAMIXEL / RS30X の応答待ちをUART単位の `ServoBus` へ集約した。待機8件・待機期限5秒・実行期限を持ち、panとtiltを含む利用者が同じ通信を同時に開始しない。使用中UARTのpin / baud / protocol違いとID重複は取得前に拒否する。
- Endpointのcloseは待機・実行中の操作を一度だけ完了させ、ID変更の予約も解放する。最後の所有者がSerialを閉じる。4種類の2軸ドライバーが構築失敗時にも取得済みサーボを解放する。
- 応答待ち中のclose、送信失敗、送信後のタイムアウトではUARTを停止状態にする。20msの待機を遅延応答の識別保証として扱わず、共有する全Endpointの終了と再生成を復旧の境界とした。DYNAMIXELの制御ループも通信失敗を成功に置き換えず停止する。復旧を案内するV2サービス・診断の接続は未完了。
- 受信長の上限とフレームの復帰処理、DYNAMIXELのbyte stuffing・CRCの除去範囲・WRITE statusエラー、RS30Xの負角度を修正した。DYNAMIXELの初期位置サンプルを保持し、トルクを切って初期化した場合にも測定位置を返す。通信失敗後の位置サンプルは有効として返さない。
- XSのpreloadがMapを読み取り専用にする点を実試験で検出したため、共通registryは実行時に遅延生成する。Node試験の成功だけで初期化可能と判断しない。
- 検証済み: Node457件、構成検査79件、SDK strict検査、6機種のmanifest、Biomeが成功。旧SingleWaitSlotのテスト3件とソース文字列の構成検査1件を、共通busの動作試験と実プロトコルのXS試験へ置き換えた。
- 全51 XS manifestが成功（63.1秒）。新しいXS試験は3プロトコルそれぞれ100回の2軸生成・送受信・終了、ID変更とその途中のclose、実ドライバーのrollbackを検証する。最終レビューで追加した初期位置保持の修正も、対象manifestの再実行で成功した。
- 最終ソースからCoreS3のreleaseビルド（6,448,752 bytes）とPWM機種takao_core2_sg90のreleaseビルド（3,751,312 bytes）が成功した。WASMビルドとブラウザー上の全4教材の受入も成功。最後のDYNAMIXEL初期位置修正はnative実装のみで、WASMは別の既存ドライバーを使用する。

設計上の契約・復旧条件・実機受入の残りは [サーボUARTの所有と操作契約](servo-bus-lifecycle.md) に記録した。実機の通信・電源投入時の応答時間・可動域は未検証。共有PY32 expander、motion全体の到達・取消し・注視の調停、V2公開APIとその他F1〜F10は引き続き未完了である。


## 共有PY32の寿命（2026-09-06）

- LEDとサーボ電源がそれぞれleaseを持ち、最後の利用者だけが物理I²Cを解放する構成へ変更した。異なるI²C設定の共有を拒否し、物理closeが失敗した場合は再取得を禁止する。閉じたleaseからのI/Oと重複closeも抑止する。
- レジスター操作を一つの基底実装へ集約した。LEDの消灯とサーボ電源の停止、構築途中の設定失敗でのrollbackをleaseの解放へ接続した。出力停止と解放が両方失敗する場合も最初のエラーを保持し、後続の解放を試みる。
- 旧getShared入口はlegacy用のleaseを共有する。新しいLED・電源のleaseとは分け、旧入口からのcloseで新しい利用者のI²Cを切断しない。物理クラスへの型注釈・instanceofを使う旧コードの移行は必要。
- XSで、preload時に捕捉したglobalThisから起動後のI²C providerを参照できない問題を検出した。providerと再試行用Timerを取得時に解決するよう変更した。
- Node465件、構成検査79件、SDK strict、6機種manifest、Biome、全52 XS manifest（67.9秒）が成功。新しいXS試験では100回の共有開始・終了、終了順の入れ替え、LEDの遅延処理、複数の設定段階での失敗、ハードウェア未検出、物理closeの失敗を確認した。
- CoreS3 release（6,452,848 bytes）、PWM機種takao_core2_sg90 release（3,755,408 bytes）、WASMビルドが成功。ブラウザー上の全4教材の受入も成功した。

詳細は [PY32 I/O expanderの共有寿命](io-expander-lifecycle.md)。この段階でもF1〜F10全体は未完了。PY32の未検出を能力情報へ反映する作業、起動時の同期再試行の取消し、同じGPIOやLED出力を操作する利用者間の調停、V1の任意の直接参照、実機受入は残る。


## 操作の停止待ちとmotionの世代管理（2026-09-06）

- 共通キューが非同期の停止確認を待ってから次の操作を開始するようにした。停止中の実行枠を保持し、初期値5秒の停止期限を追加した。停止失敗・停止期限では後続操作を失敗させ、再利用を禁止する。`close()` も同じ停止完了を待ち、停止自体の失敗を伝える。
- motion controllerはドライバー交換前にcallbackとTimerの世代を無効化する。古い位置取得、トルク投入、動作受付から新しい機器へ処理が連鎖しない。古い明示コマンドは一度だけ失敗させ、attach失敗時は途中の接続を回収してcontrollerを閉じる。
- DYNAMIXELは実際に送ったGoal PositionだけをACK後に記録する。応答待ち中に新しい目標が入っても次の制御周期に送信する。初期位置取得で、既に受け付けた目標を上書きする経路も修正した。
- Node471件、構成検査79件、SDK strict、6機種manifest、Biomeが成功。全52 XS manifestも成功（55.7秒）。実Timerを使う100回の停止・資源引き渡し、100回のドライバー交換、実DYNAMIXELプロトコル上の目標変更を検証した。
- CoreS3 release（6,456,944 bytes）、PWM機種takao_core2_sg90 release（3,759,504 bytes）、WASMのビルドが成功。新しいWASMホストで、ブラウザー上の4教材すべての受入も成功した。

契約と限界は [操作の停止待ちとmotionのドライバー世代](motion-operation-lifecycle.md)。低レベルcallbackと再利用バッファは維持している。この段階ではV2のmotion API、到達と推定の区別、注視と単発移動の調停、実機受入は未完了。今回のキュー変更だけで、各機種の物理停止やAppSessionの全使用権を接続したことにはしない。F1〜F10の実装を継続する。

## V2 motionと教材の接続（2026-09-06）

- 公開SDKへ `motion.move` / `lookAt` / `lookAway` / `stop` と能力・可動域の型を追加した。角度を度、時間をmsで検証し、初期位置からの軌道、最終送信、実測可能な機種の2回の到達確認を共通エンジンで扱う。PWMとWASMは推定完了を返す。
- AppSessionがmotionサービスを所有し、アプリ終了時に停止・保持・対応機種のトルク解除を待つ。raw機器はHostに保持する。注視先は一つに集約し、単発移動の停止・実行・最新の注視先への復帰を同じキューで扱う。
- サーボごとのportを追加し、DYNAMIXELの自動制御から操作権を受け渡す。準備中に権利を解除した後の遅延ACKからトルクを再投入しない。必要なPY32電源の未検出はmotionのunavailableとして公開する。SCServoの読み取り中心とM5StackChanのclampされた測定も修正した。
- WASMはprivateなbrowser driverへC bridgeから値を送り、利用先不在や送信失敗を成功に置き換えない。実ブラウザーで、Moddable 9.5の未実装 `Time.ticks` により軌道が進まない問題を検出した。共通 `clock-ticks` にWASMの経過時計を接続し、manifestで既定実装を明示的に除外する。JS/TSの混在した別名解決をビルド成功だけで判断しない。
- 新しいJavaScriptの首振り教材とSDK文書・motionの設計記録・minor changesetを追加した。
- 最終検証: Node479件、構成検査79件、SDK strict検査、6機種のmanifest、Biomeが成功。全53 XS manifestが成功（78.0秒）。新しい試験は実TimerとPWMを通した100回のAppSession寿命、実プロトコル上のDYNAMIXELの制御権、停止中のBUSYとCANCELLED、停止失敗後の利用不可状態を含む。
- 最終ソースからCoreS3 release（6,489,712 bytes）、PWM機種takao_core2_sg90 release（3,792,272 bytes）、WASMのビルドが成功した。5教材すべてをChromium上の生成済みWASMホストへ順に読み込み、音声の再生開始、入力、首の3軌道の順序・最終指令・経過時間の受入が成功した。Host descriptorは引き続き `9.5.0+stackchan.1` で、V2配布metadataは未完了。

現段階でもF1〜F10全体は未完了。全V1 MODの移行、既定動作、音声入出力・会話・USBの調停、設定とボードの正本、V2配布metadata、実機および初学者による受入を継続する。desktop版Timeの壁時計依存と、既存入力を含む各platformの時刻入口の統一も残る。

## 設定定義と保存経路の共通化（2026-09-06）

- `settings-schema.ts` を本体と Web の正本にした。19 の管理キーの型、選択肢、既定値、範囲、UTF-8長、秘密情報、適用時点を定義する。旧 `PREF_KEYS` と Web の設定モデルもここから生成する。モデルだけを使う UI と永続化サービスで manifest を分け、UI 単独ビルドにも同じ定義を供給する。
- `SettingsService` へ設定解決と保存を集約した。優先順位は共通既定値 < 本体 < MOD < 保存値。Wi-Fi は本体が管理し、MODの既定値を使用しない。固定ドライバーは本体指定だけを採用する。起動時の Wi-Fi と機器構成は同じ設定解決結果を使う。
- 一括保存は全項目の検証後に開始し、保存例外では変更を試みたキーを復元する。復元失敗後の保存を停止する。小数は文字列で保存し、任意設定の空欄は保存値を削除する。本体の設定画面も同じ保存を使い、SSID とパスワードをまとめて保存し、失敗時は画面で通知する。
- 設定BLEプロトコル2を追加した。受信上限32KiB、受信期限3秒、MTUに合わせた改行フレーム分割、送信待機量上限、切断・close時の両方向timer解放を持つ。成功・検証失敗・保存失敗をrequestIdに対応する応答で返す。入力JSONや秘密情報の値をtraceしない。
- Webは保存応答を10秒待ち、切断・タイムアウト・旧本体への未確認送信を保存成功と表示しない。初期通知と保存結果は秘密情報をマスクし、変更していない秘密情報を再送しない。消去の予定と取消し、新しい秘密情報の保存後の入力欄クリア、有効値への更新、保存中に作られた新しい編集の保持を接続した。接続を切り替えた後の古い非同期書き込みが新しい保存を失敗させないことも検証した。
- 検証: Node 489件、構成検査79件、SDK strict検査、6ターゲットのmanifest検査、全54 XS manifestが成功（4 jobs、119.6秒）。BLEサーバー試験はNodeのTimer偽物からXSへ移した。既存の2 Node試験を移行したため、Node件数は追加試験数と単純には一致しない。
- CoreS3 release は6,506,096 bytes、PWM `takao_core2_sg90` release は3,808,656 bytesで成功。WASMビルドも成功し、5教材すべてのChromium受入が成功した。Webは既存Node試験208件、React試験66件、strict型検査とビルドが成功した。Biomeは既存Digest偽物のconstructorに関するinfo 1件のみ。
- UI単独のXS試験が設定定義のmanifest依存漏れを検出したため、共通モデルmanifestへ修正した。設定エラーの中国語表記は既存フォントで表示できることを構成検査で確認した。Node/Webだけの成功を本体への組み込み完了とは扱わない。
- プロトコル2本体は同じ版のWebツールと組み合わせる。未知の設定キーのBLE保存とMODのWi-Fi既定値に対する互換性変更を含むため、この段階のchangesetはmajorとした。公開・配布・実機BLE受入は未実施。

設計と移行上の制約は [設定サービス](settings-service.md)。F7 / F8 は引き続き未完了で、ボードのpin・校正制約、プロバイダー話速の単位、限定的なアプリ設定API、設定スナップショットの準備状態、起動サービスの取消し・終了、電源断をまたぐ永続化、既存MODの直接Preference利用を残す。F1〜F10全体の完了条件は変更しない。


## 起動・Wi-Fi・ローカル通信の所有（2026-09-06）

契約の詳細は [起動と接続の所有・終了契約](boot-connectivity-lifecycle.md)。この節は F2 / F4 / F8 / F9 の進捗であり、F1〜F10 全体の完了ではない。

- ホストが `BootSession` を所有し、接続待ち・再試行の待ち・復旧選択待ち・Wi-Fi 使用権・ローカル通信を閉じる。開始直後の取消しでも前の起動を閉じ、前の終了完了まで新しい通信を開始しない。前の起動を保持するクロージャーも終了開始時に解放する。
- `NetworkManager` を共通化し、同じ接続先を最大16利用者で共有する。異なる接続先は `BUSY`。最後の利用者がアダプターを閉じ、V1のグローバル停止は自分の使用権だけを返す。利用者を管理器で保持し、物理アダプターに最初の利用者の不要なコールバックを残さない。
- スキャンから NTP まで一つの接続期限を設けた。終了・期限切れ・前の試行の結果を無視し、閉じたアダプターの復活を禁止した。NTPやdisconnectの解放失敗でもアダプターのcloseを試み、失敗を保持して再利用を拒否する。
- 設定画面の接続テストは「戻る」「起動」の両方で閉じる。画面・BLE・Wi-Fi・音声の解放は途中の失敗で中断しない。復旧画面の物理ボタンとPiu表示は、自分が取り付けたものだけを戻す。終了済みのスキャンから画面を更新しない。
- LocalPeerServiceの終了を追加し、接続開始途中と下位送信の完了待ちを取消し可能にした。物理closeの失敗を隠さず、そのサービスでの再接続を拒否する。
- XSで追加のPromise処理が同期スタック上限に達する問題を検出し、送信開始をmicrotaskに移した。既存の配送試験は、送信ACK後に受信側の購読処理が進むことを、固定回数のmicrotask待ちで仮定していた。受信イベントそのものを期限付きで待つ試験へ変更し、ACKを購読処理より先に送る契約を維持した。
- NetworkReadyResultを一箇所へ集約し、availabilityと実際の状態を公開した。WASMはWi-Fi接続成功を偽装せず、直接接続は `UNSUPPORTED`、起動は `skipped` を返す。
- 生成makefileでESP32のMAC取得がsim版TSを選んでいたことを確認し、manifestに明示的な除外を追加した。CoreS3の再ビルドでは `util/esp32/mac-address.ts` とC実装が選ばれることを確認した。実機のMAC値の確認は未実施。

検証記録:

- Node 499件、構成検査79件、SDK strict検査、6ターゲットのmanifest検査が成功。
- 全55 XS manifestが成功（4並列、62.0秒）。最後に追加した参照解放の修正も、ネットワーク寿命XS試験（2.3秒）とNode全499件で再確認済み。
- XSには接続の共有・所有者別の終了100回、遅延したスキャンとNTP、再接続タイマー取消し、解放失敗、起動置換、LocalPeerService終了100回・開始途中の終了・Piu復旧画面の解除を含む。
- 最終ソースでCoreS3（6,518,656 bytes）、PWM / takao_core2_sg90（3,821,200 bytes）、WASMのビルドが成功。Chromiumで5教材の起動・顔・tone・入力・発話・motionが成功した。実機の電波・モーター・音声出力は未検証。

残る範囲: V1の直接参照・起動待ち全体、Wi-Fiスキャン/BLE/ESP-NOWの全利用者間の物理的な調停、ローカル通信の全操作の期限、native音声とWASMカメラの下位資源、V2の残りの能力・配布metadata・既存MOD移行・実機と初学者の受入。これらを含め、全課題の解消を継続する。


## 一枚撮影・画像表示とカメラの終了（2026-09-06）

詳細は [撮影と画像表示](camera-capture-lifecycle.md)。F1〜F10全体の完了ではなく、カメラに関する公開契約と寿命を接続した段階である。

- `app.camera.capture` / `camera.info` と `app.ui.showImage` / `hideImage` を追加した。AppSessionが撮影キューを所有し、画像はnativeフレームからコピーする。元フレームの解放とカメラ停止が済んでから撮影を完了する。V1の一枚撮影もカメラ停止後に共有入力を戻す。
- 寸法・形式・バイト数の上限、実行・待機・停止の期限、取消し、競合、解放失敗をSDK契約へ接続した。RGB565表示とJPEG取得を区別し、未対応形式を成功にしない。画像型を独立させ、低レベルカメラの型からアプリ全体の型定義を要求しない。
- nativeの最初のフレーム待ちに機器と開始世代の検査を加え、stop / close時に待機・Timer・取消し登録を除く。100回の停止・再開で、古い撮影が新しいフレームを消費せず、古いonReadableが新しい機器を読まないことを確認した。
- WASMのbridgeを固定し、同じbridgeの所有をCamera間で管理する。開始・フレーム待ち・停止を閉じ、古いcloseが新しい撮影を停止しない。ブラウザーの許可拒否・未取得・canvas失敗を合成画像で成功にする動作を廃止し、合成画像は明示的に選択した場合に限った。
- ブラウザー受入で、preload済みの読み取り専用オブジェクトをWeakMapのキーにできないXS固有の制約を検出した。通常のMapと参照数で所有を管理し、最後のCameraが正常終了すると表から除く。停止失敗は復旧境界まで保持する。
- ブラウザーでのMOD再起動・ページ終了でも、古いC bridgeの開始予約とメディア入力を閉じる。XSを終了するだけでは、ブラウザーへ渡したPromiseは消えない。終了途中で失敗しても後続の解放を試みる。
- `06-camera` 教材とstrict契約試験を追加した。実Piuの表示・置換・非表示・アプリ終了を確認した。UI試験の一つがモジュール評価中の画面構築でXSのスタック上限に達したため、ホストと同様に評価後のmicrotaskで実行する試験へ変更し、スタックサイズは増やしていない。

検証結果:

- Node 496件、構成検査79件、SDK strict検査、6ターゲットのmanifest検査が成功。旧WASMカメラのNode試験11件をXSへ移し、新たな公開操作と終了のNode試験8件を追加したため、Nodeの総数は前段の499件から496件になった。
- 全56 XS manifestが成功（4並列、61.8秒）。native / WASMのカメラ、アプリ、Piuを含む。Biomeは既存Digest偽物のconstructorに関するinfo 1件のみ。
- CoreS3 releaseは6,535,040 bytes、PWM / takao_core2_sg90 releaseは3,837,584 bytesで成功。WASMビルドと6番目の教材archive生成も成功した。
- WebのNode 214件、React 66件、strict型検査とビルドが成功。Chromiumで6教材を起動・操作し、撮影教材ではC bridgeからSDKへ実バイト列が渡ること、Piu描画後のカラー画素、撮影後の全track停止を確認した。動作中のブラウザーカメラもファームウェア再起動でtrack数が0へ戻ることを確認した。
- 描画の確認は撮影停止からの固定時間待ちにせず、実際の画素が描画されるまで期限付きで待つ。ブラウザーの映像源はChromiumのテスト用メディア入力で、物理カメラの受入ではない。

実機カメラの画質、共有I2C、DMA・メモリー、機種ごとの遅延は未検証。録音・会話・設定のV2公開サービス、native音声、既定動作、全MODの移行、配布metadata、実機と初学者の受入を含む残りの範囲を継続する。


## MOD の宣言・ビルド・書き込みの接続（2026-09-06）

詳細と経路別の未完了項目は [MOD の互換性検査](mod-package-compatibility.md)。この変更は F10 の一部で、F1〜F10 全体の完了ではない。

- `stackchan-mod.json` の schema 2へ、アプリ API、必要な host API、任意の使用機能を追加した。schema 1 は旧 API 1として維持し、新しい要求を紛れ込ませた schema 1は拒否する。共通 parser と XSA readerはJavaScriptのJSDocでstrict型検査し、DOM・Node依存を持たせない。
- XSAのatomとresourceをモジュールの実行なしで読み、境界・版・UTF-8 JSON・16KiB上限・実行入口と宣言の一致を検査する。実行入口は実際のspecifierと比較する。最初のブラウザービルド試験でJSONが同梱されていないことを検出し、標準manifestの`resources`ではなく`data`を使用した。
- Webビルドは宣言を必須にし、生成後にも入力との一致を検査する。Blocklyの宣言は現行のコード生成と同じ app API 1で、使用機能はworkspaceの解析結果から得る。全Blockly生成コードをSDK世代2へ移行したことにはしない。
- ネイティブの`mod:build` / `mod`も生成後を検査する。隣接する宣言がある場合は同梱を必須にし、入れ忘れや古い宣言との不一致を拒否する。6教材はAPI世代2の宣言を同梱し、発話・首振り・撮影の未対応時の案内を任意機能として表す。
- CLIとWebSerialは、archiveの宣言を本体のhost API世代と比較し、利用者の確認callbackや書き込みより前に拒否する。情報のない旧MODは移行期間中の例外として検査不能を明示する。壊れた宣言をこの例外へ戻さない。例外の終了、SD・WASM・起動時のimport前の検査は未完了。
- host APIの値を共通契約へ移し、descriptorを世代2へ更新した。生成バイナリーを読んで、Takao Core2は従来Git名だけを版としていたことを検出した。Stack-chan RT / Takao Core2にも版情報の生成とCLIのSDK版確認を接続し、通常ビルドとbundleの最終manifest適用を共通化した。旧本体の更新が必要になるため、firmwareのchangesetはmajorとした。

検証:

- Node 504件が成功。共通JavaScript契約のstrict検査を`test:unit`へ含めた。構成検査79件、SDK strict検査、6機種のmanifest検査も成功した。JSON Schema Draft 2020-12による15件の教材・Gallery定義の検証も成功した。
- WebのNode 218件、React 66件と型検査・ビルドが成功。実際のWASM版mcrunで旧API 1と新API 2のarchiveを生成し、同梱・実行入口・宣言の検査を行った。CLI / WebSerialはhost API 1への世代2 MODの書き込みを拒否し、API 2では進める試験が成功した。
- ネイティブmcrunで6教材を再生成し、各archiveから世代2の宣言とXS 17.8.2を読めた。ChromiumのWASMホストで6教材の起動・操作、カメラ画像の描画とtrack解放が成功。WASMのホストソースは変更していないので、前段で生成したホストを使用した。
- CoreS3 release 6,535,040 bytes、Takao Core2 release 3,837,584 bytes、Stack-chan RT release 3,954,160 bytesを生成し、3つの実バイナリーから`9.5.0+stackchan.2`を確認した。実機への書き込みは行っていない。
- この段階では本体のアプリ実行コードを変更していない。全XS実行試験は前段の56 manifestの成功記録を維持し、今回の変更の検証にはNode・生成物・ブラウザーとネイティブのビルドを使った。

残るF10: 全既存MOD / miniappとGallery artifactの宣言・移行、外部宣言とartifactの同一性、SD・WASM・起動時の必須検査と復旧UI、機種および設定から得る実際の能力表、全ビルド入口の統合、実機・初学者の受入。F1〜F9の残りも引き続き同じ範囲で扱う。


## MOD の全導入経路・保守起動・復旧画面（2026-09-06）

詳細は [互換性検査](mod-package-compatibility.md) と [旧MOD移行台帳](legacy-mod-migration.md)。F10の必須検査を接続した段階であり、全課題の解消ではない。

- 宣言のないarchiveの導入例外を終了し、CLI・WebSerial・SD・WASM保存／読込・起動時の全経路で必須検査する。schema 1の正しい宣言はAPI 1として維持する。WebSerialはXS互換範囲とModdable 9.5も確認し、承認callbackと書き込みより前に拒否する。
- 共通のXSA readerで外部宣言との正規化後の一致を照合し、ネイティブ／WebビルドとGallery取得へ接続した。全32旧例へAPI 1の宣言を加え、6つのGallery／シミュレーター配布archiveを標準mcrunで再生成した。特殊サーボ診断3例は通常機種に適合済みとは宣言しない。
- 起動を小さなmainとapp-mainに分け、mod/config・mod・miniappを評価する前に宣言を検査する。宣言と実際のexportの世代も照合する。拒否時はMODの設定を読まず、ホストの言語設定とエラーコードで復旧画面を表示する。
- SDのMOD選択操作は、ホスト所有の保守要求を保存して再起動する。次のVMで要求を一度消費し、MODを実行せずに書き込み画面を開く。V1の独自Timerをcontextの終了だけで止められるとは扱わない。成功と戻る操作は再起動する。
- 実コードの確認でResourceもMOD内の同名リソースを先に読むことが分かった。保守・拒否時はUIのimportより前にSDK 9.5のfxSetArchiveでarchiveを切り離す。プラットフォームが所有するマッピング／確保領域はそのまま終了時に解放させる。
- IndexedDBはputの成功だけでなくtransactionのcommitを待つ。WASMはarchiveの検査前に確保しない。起動されていないVMへのquit、終了後に読み込みが完了してVMを開始する経路も修正した。
- 同名modフォルダーを連続ビルドすると前のCODE／DATAが残る問題を実際のGalleryビルドで検出し、MODごとの生成領域をビルド前に作り直す。provider-dialoguesのMOD用manifestを分離し、型参照のためだけに暗号・ネットワーク等のC実装を同梱しない。旧Maybe型の正本も独立させた。

検証:

- Node 506件、構成検査79件、SDK strict検査、6機種のmanifest検査が成功。全48宣言のJSON Schema 2020-12検査が成功。宣言世代とexport世代の不一致も検査する。
- 全57 XS manifestが成功（4並列、110.8秒）。実TextDecoder・Resource・Modulesによる起動前検証、保守要求の一度だけの消費、アーカイブ切り離し後のホスト参照、実PiuのSD画面で許可前の拒否と不適合MODの書き込みゼロを含む。
- 全32旧例のMOD archiveを標準mcrunで生成した。途中で見つかったnative依存と型の別名の問題を修正し、影響する会話3例も最終構成で再ビルドした。宣言の付与とビルド成功は、SDK移行や実機の動作保証とは区別する。
- WebのNode 222件、React 67件、型検査とビルドが成功。Chromiumで6教材の起動・操作、撮影画像の表示と全trackの終了を確認した。
- 別のChromium試験は、Web導入層を意図的に迂回してfuture API 999の実archiveをWASMへ渡した。mod/configとmodの評価マーカーが出ず、ホストとWebの復旧案内が表示された。MODに不正な同名locals.mhiを同梱しても、ホストのリソースで表示できた。試験はweb/simulator/mod-preflight-visual.mjsに保存した。
- 最終ソースからCoreS3 6,547,408 bytes、Takao Core2 3,845,856 bytes、Stack-chan RT 3,966,512 bytesのreleaseとWASMを生成した。3つの実バイナリーから9.5.0+stackchan.2を確認した。

残る範囲: 実際のボード・設定・利用可能な能力と配布metadataの照合、全ビルド入口と型・module exportsの統合、旧MOD／BlocklyのSDK移行、録音・会話・設定と拡張の公開API、native音声等の寿命、既定動作の分離、SD書き込み中の電源断を含む実機・初学者の受入。F1〜F10の全範囲を継続する。


## native録音の完了・期限・解放（2026-09-06）

詳細は [マイクの寿命](microphone-lifecycle.md)。native Microphoneと共通RuntimeAudioの接続であり、WASM録音とV2公開APIは継続する。

- 入力取得後の形式確認、確保、取消し登録、Timer設定、開始が失敗した場合も入力を解放する。成功・失敗・取消しで同じ終了処理を使い、close失敗を成功扱いせず、そのMicrophoneの再取得を禁止する。
- WAVは実際に受信したバイト数で埋める。空・不完全なPCM・過大な読み取りはIO、受信停止は期限切れとし、残りをゼロで埋めて成功にする処理を廃止した。時間1〜15,000 msと512 KiBのWAV上限を共通の純粋なヘルパーへ集約した。
- 開始の世代と入力の同一性で、旧入力の遅い通知を抑える。再入した終了の途中で次の入力を取得しない。
- SDK 9.5のCコードから、onReadable実行中のcloseで入力レコードが通知待ちのまま残り得ることを確認した。通知から戻った次のPromise jobへcloseを移し、録音の完了は実際の解放を待たせる。低レベルのstop / closeも必要な場合に解放完了のPromiseを返す。
- RuntimeAudioの録音に操作ごとのsignalを接続した。待機中の取消しでは実行中の別操作を止めない。共通ownMicrophoneは非同期のclose／stopの戻り値をResourceScopeへ返し、ホストの終了も解放を待つ。
- nativeのNode試験4件をXSへ移した。既存WASM Node試験が他の試験の別名ファイル作成に依存していたため、その試験自身が別名を用意してから実装を読み込むようにした。

検証:

- Node 506件、構成79件、SDK strict検査、6機種のmanifest検査が成功。純粋なWAV構造2件とRuntimeAudioの取消し・解放待ち2件を追加したので、native試験の移行後もNodeの総数は506件。
- 全58 XS manifestが成功（4並列、73.3秒）。nativeマイクの100回の録音・取消しで入力、Timer、取消し登録が残らず、全入力に一度だけcloseが呼ばれ、通知の実行中にはcloseされないことを確認した。短い読み取り、開始途中の失敗、予算超過、期限、再入、遅い通知、二重close、解放失敗を含む。
- CoreS3 release 6,551,504 bytes、Takao Core2 release 3,854,048 bytes、Stack-chan RT release 3,974,704 bytesとWASMを生成した。全nativeバイナリーから9.5.0+stackchan.2を確認した。
- Webの型検査・ビルドと、Chromium上で6教材の起動・操作・撮影画像の表示・track解放が成功。Webアプリ本体のコードはこの段階では変更していない。

残る範囲: WASMの録音bridgeとブラウザー資源の所有、V2録音・会話・設定・拡張API、入力と出力・会話・USBの共通調停、native TTSと機器交換、既定動作と旧MODの移行、実際の能力表、実機の音質・メモリー・I2S・遅延の受入。F1〜F10の全範囲を継続する。

## WASM録音とブラウザー入力の終了（2026-09-06）

詳細は [WASM録音の所有と停止確認](wasm-recording-lifecycle.md)。F2 / F3 / F9の録音経路と、F10の失敗したビルドの扱いを接続した。

- Browser AudioInが録音識別子ごとに許可要求・MediaRecorder・track・データ変換を所有する。CとWASM Microphoneに重複していた入力状態を取り除き、停止と結果の回収を同じ識別子で扱う。
- WASM Microphoneの取消し、期限、stop / closeの解放待ちを接続した。未対応を空バッファの成功にせず、録音のMIME typeと拡張子をC境界の前後で保つ。入力のcloseで出力を閉じる経路も取り除いた。
- 再起動ではBrowser AudioInのsuspendを待ち、次のVM起動まで入力を再開しない。許可待ち中や停止中に画面を破棄しても、ブラウザー側の継続処理が遅れて得たtrackを閉じる。停止を確認できなければ後続録音・再起動を止める。
- 期間・バッファ・準備と停止期限の定義を共通JavaScriptへ集約した。ModdableのTSからも同じ定義を読むためallowJsを有効にし、それにより判明した設定画面のキーボード引数の型問題を修正した。
- XS試験で、型エラーでもTypeScriptが生成した途中ファイルを次のmakeが再利用する問題を再現した。失敗出力を破棄し、準備ビルド失敗後は試験を開始しない。WASMのmake失敗時も途中出力を破棄する。失敗するコンパイラーを注入したCLI試験で、この経路を検証した。

検証記録:

- Node 504件、構成検査79件、SDK strict、6ターゲットのmanifest検査が成功。NodeからWASM Microphoneの旧3試験をXSへ移し、CLIのビルド失敗試験を1件追加したため、直前の506件から総数は減っている。
- 新しいXS録音試験とnative録音試験をclean buildで実行し成功。その後、リポジトリのcleanコマンドで生成物を破棄し、全59 XS manifestが成功（4並列、276.1秒）。WASM Microphoneは実Timerで100回の成功と100回の取消し、停止確認待ち、解放失敗、識別子と購読の回収を確認した。
- 同じソースからCoreS3 release（6,551,504 bytes）、PWM / takao_core2_sg90 release（3,849,952 bytes）、Stack-chan RT release（3,974,704 bytes）、WASMがビルド成功。
- WebはNode 241件、React 67件、strict型検査とビルドが成功。Chromiumの実MediaRecorderを使った結合試験で、録音のバイト・形式の往復、再生、取消し、進行中の再起動、遅れた許可、WasmView破棄時のtrack解放が成功した。既存6教材とカメラの終了の受入も成功。
- 物理マイクの音量・音質・消費メモリー、Safariなど他ブラウザー、実機の取消しと可動部は未受入。ビルド成功をその代用とはしない。

次はAppSessionの音声所有、録音・再生の公開SDKと教材、native TTSなどの音声出力、会話・USBの調停へ進む。既存MOD移行、設定の公開API、ボード正本、能力metadataと全ビルド入口、実機・初学者受入を含むF1〜F10全体は引き続き未完了。
