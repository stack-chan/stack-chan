# Firmware SDK 再設計の実装・検証台帳

起点は `origin/feat/moddable-9.5` の `6eb462331dd1677791d6aa2a6b257a20da43b9a9`。
作業ブランチは `codex/firmware-sdk-redesign`。調査資料は [2026-09-05 のレビュー](reviews/2026-09-05-firmware-redesign/README.md)。

この台帳は完了宣言ではない。各項目は、実装とその契約を検証する証拠が揃うまで未完了とする。

| 課題 | 必要な最終状態 | 状態・検証先 |
| --- | --- | --- |
| F1 公開境界 | V2 の SDK は旧 flat API、具体的 TTS・sensor・Piu controller を含まない。高度な拡張を別入口にする | 基本SDKとmotionをAppSessionへ接続。録音・カメラ・会話・設定・高度な拡張は未完了 |
| F2 寿命 | Host / App / Operation の所有を接続。開始失敗の rollback、取消し、一度だけの完了、終了後のコールバック抑止 | composeとcontextのrollback、UI・入力・カメラ、サーボUART、共有PY32の終了とmotion置換時の世代管理を接続。boot services、WASMカメラの下位資源管理などは継続 |
| F3 操作契約 | 完了・エラー・未対応・時間・単位・入力検証を統一。say と素材再生を分離。motion の指令受付と到達を区別 | V2のspeech/clip、motionの度・ms・measured/estimated・期限・取消しを接続。他機能と実機での到達確認は未完了 |
| F4 競合と重複 | 音声、会話、USB、motion、物理 UART の資源管理を共通化。上限・期限・取消しを保証 | 通常音声とV2 motionに停止待ち付きOperationQueue、サーボUARTに共通FIFOを接続。注視と単発移動を調停。会話・USB・V1移行は未完了 |
| F5 教材適合 | 全 MOD／miniapp の入口を分類・移行。公開契約に適合し、機種差の回避策を基盤へ移す | JavaScriptの5教材とSDK型検査を追加。既存MOD／miniapp移行は未完了 |
| F6 アプリ構成 | 既定動作、診断、UI 拡張の責務と寿命を分ける。既定動作にも SDK と AppSession を使用 | 未着手 |
| F7 正本 | 共通 manifest、ボード設定、公開型と module exports の正本を統一。target 別の型検査を成立させる | 共通 host runtime、TTS契約、設定定義とモデル用manifestを一本化。Webも同じ設定定義を参照。ボード・残りの公開型・型検査は未完了 |
| F8 設定・起動 | 型・検証・優先順位・secret・適用時点を共通設定サービスへ集約。オフライン教材を Wi-Fi 待機から独立 | V2起動をWi-Fi待機から独立。SettingsServiceを設定画面・BLE・設定読み込みへ接続し、Wi-Fi起動の優先順位を統一。アプリ公開API・準備状態・V1起動と終了・電源断時の保証は未完了 |
| F9 WASM | native / simulated / unsupported を明示。無音・未実行の成功をなくす。教材の状態遷移を共通検証 | TTSの失敗・取消し、motionの構造化bridgeと推定完了、WASMの経過時計を接続。その他の能力metadataと教材適合は未完了 |
| F10 検査・配布 | 公開依存・JS / TS 教材・型・ライフサイクルを実効的に検査。V2 metadata を Web / CLI / SD / WASM で起動前検証 | SDKのAST依存検査と全新教材のstrict検査を追加。V2 metadata配布は未完了 |

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

1. V2の基本SDK・motion・AppSessionは接続済み。録音・カメラ・会話・設定の公開サービスと拡張を実装し、既存MOD／miniappへ移行する。
2. composeの取得直後の登録とcontextのrollbackは接続済み。サーボの共有UARTとPY32 expanderの終了は接続済み。boot services、native音声エンジン、WASMカメラの下位資源を終了経路へ接続する。V1の直接参照と機器置換の寿命も継続して扱う。
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
