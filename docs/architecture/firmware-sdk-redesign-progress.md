# Firmware SDK 再設計の実装・検証台帳

起点は `origin/feat/moddable-9.5` の `6eb462331dd1677791d6aa2a6b257a20da43b9a9`。
作業ブランチは `codex/firmware-sdk-redesign`。調査資料は [2026-09-05 のレビュー](reviews/2026-09-05-firmware-redesign/README.md)。

この台帳は完了宣言ではない。各項目は、実装とその契約を検証する証拠が揃うまで未完了とする。

| 課題 | 必要な最終状態 | 状態・検証先 |
| --- | --- | --- |
| F1 公開境界 | V2 の SDK は旧 flat API、具体的 TTS・sensor・Piu controller を含まない。高度な拡張を別入口にする | 基本SDKとdefineAppを追加しhostへ接続。motion・録音・会話・高度な拡張は未完了 |
| F2 寿命 | Host / App / Operation の所有を接続。開始失敗の rollback、取消し、一度だけの完了、終了後のコールバック抑止 | 共通 ResourceScope、音声取消し、motion の終了を実装。AppSessionをhostへ接続し、取消しと個別キュー操作を接続。composeのrollbackは未完了 |
| F3 操作契約 | 完了・エラー・未対応・時間・単位・入力検証を統一。say と素材再生を分離。motion の指令受付と到達を区別 | V2のspeech/clipと音声のError契約を接続。motionと他の機能は未完了 |
| F4 競合と重複 | 音声、会話、USB、motion、物理 UART の資源管理を共通化。上限・期限・取消しを保証 | 通常音声に上限・期限付き OperationQueue を接続。会話・USB・motion・UART は未完了 |
| F5 教材適合 | 全 MOD／miniapp の入口を分類・移行。公開契約に適合し、機種差の回避策を基盤へ移す | JavaScriptの4教材とSDK型検査を追加。既存MOD／miniapp移行は未完了 |
| F6 アプリ構成 | 既定動作、診断、UI 拡張の責務と寿命を分ける。既定動作にも SDK と AppSession を使用 | 未着手 |
| F7 正本 | 共通 manifest、ボード設定、公開型と module exports の正本を統一。target 別の型検査を成立させる | 共通 host runtime manifest と TTS 契約を一本化。ボード・残りの公開型・型検査は未完了 |
| F8 設定・起動 | 型・検証・優先順位・secret・適用時点を共通設定サービスへ集約。オフライン教材を Wi-Fi 待機から独立 | V2起動をWi-Fi待機から独立。SettingsServiceとV1起動移行は未完了 |
| F9 WASM | native / simulated / unsupported を明示。無音・未実行の成功をなくす。教材の状態遷移を共通検証 | TTS stub の失敗通知、再生取消しと timer 回収を実装。能力 metadata と教材適合は未完了 |
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

1. V2の基本SDK・AppSessionは接続済み。motion・録音・カメラ・会話・設定の公開サービスと拡張を実装し、既存MOD／miniappへ移行する。
2. compose の取得直後の資源登録、開始失敗 rollback、runtime context の同一 close Promise、入力の解除と UI の終了を実装する。
3. 音声出力の個別取消しはAppSessionへ接続済み。音声入力と出力、WASM bridgeのclose、会話とUSBの資源を調停する。
4. driver callback の世代管理を置換時と native TTS の出力にも適用する。資源解放失敗後に待機中の操作を開始しない契約をさらに検証する。
5. 最小教材から残りの F1〜F10、配布・移行・実機受入まで続ける。現時点では全課題を解消した状態ではない。

## V2 基本SDKの接続（2026-09-06）

- `firmware/sdk` に基本AppContext、defineApp、CancellationSignalを追加。host内のTaskScopeとAppSessionがアプリ終了時に入力・周期処理・音声操作を閉じる。V1との混合を型検査で禁止した。
- Node 439件、構成検査80件、6ターゲットのmanifest検査が成功。XSの100回AppSession試験と、Piuを含む実ホストcontextでの取消し・raw入力復元試験が成功した。
- Linuxホストのビルドが成功。4つの新規JavaScript教材はstrict型検査が成功。教材の実機・ブラウザーでの動作確認は未実施。
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
npm run build:wasm
npm run mod:build -- lessons/01-face/manifest.json
npm run mod:build -- lessons/02-tone/manifest.json
npm run mod:build -- lessons/03-input/manifest.json
npm run mod:build -- lessons/04-speech/manifest.json
```

Web側は `web` から `npm test` と `npm run test:sdk-lessons`。Chromiumが既定の場所にない環境では `CHROMIUM_PATH` に実行ファイルを指定する。実機の電源・音質・可動域の受入は未検証のままである。
