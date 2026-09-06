# 旧経路の撤去とサンプル整理

対象は [実装計画](firmware-sdk-redesign-progress.md) の F5 / F6 / F11。2026-09-06 時点の撤去台帳であり、全項目の完了宣言ではない。残す機能を SDK へ移した実装と、その機能の旧経路を削除した差分を一組として確認する。

## コード量の起点

比較起点は Moddable 9.5 対応ブランチの `6eb462331dd1677791d6aa2a6b257a20da43b9a9`。以下の「整理前」は `f525e97fdb4c35fd51465a640223033217ed925c`。作業中の未コミット文書を計測に混ぜない。

| 分類 | 起点のファイル数 / 物理行数 | 整理前のファイル数 / 物理行数 |
| --- | ---: | ---: |
| firmware の実装 | 287 / 36,949 | 322 / 42,627 |
| 新 SDK・共通契約 | 0 / 0 | 12 / 428 |
| Web の実装 | 107 / 15,002 | 111 / 16,007 |
| 型宣言 | 25 / 751 | 25 / 757 |
| **製品ソース計** | **419 / 52,702** | **470 / 59,819** |
| サンプル・教材（別計上） | 52 / 8,220 | 59 / 8,319 |
| 試験・試験補助（別計上） | 256 / 26,678 | 311 / 36,282 |
| 開発ツール（別計上） | 35 / 3,967 | 36 / 4,057 |
| vendor・既知の生成物（別計上） | 8 / 2,715 | 8 / 2,715 |

製品ソースは **51ファイル・7,117行の純増**。新 SDK が動いたことをコード量削減の達成としない。移行後にこの増加を解消する必要がある。

集計規則は [measure.py](evidence/firmware-retirement/measure.py) に固定した。Git に記録された firmware と Web の TS / JS / C 系ソースを集計し、サンプル・教材・試験・開発ツール・vendor を別計上する。物理行数は空行・コメントを含み、論理 LOC ではない。Markdown、JSON、HTML、CSS、画像・音声、非追跡のビルド出力はこの表に含まない。これはプログラムソースの基準測定であり、リポジトリー全体の容量測定ではない。

`Generated` というコメントだけで除外しない。例えばミニゲーム集の合成済みソースは、維持されているサンプルとして計上する。ファイル移動や教材への付け替えで製品列だけを小さくした場合も、削減とは認めない。実際に消えた責務・重複・公開入口を差分で説明する。コメント削除や圧縮を成果にしない。

```sh
python3 docs/architecture/evidence/firmware-retirement/measure.py
python3 docs/architecture/evidence/firmware-retirement/measure.py f525e97 --files > source-inventory.json
```

後者で対象ファイル一覧・分類・行数・内容のハッシュを再現できる。公開入口と操作の中継数については次節で現存経路を列挙したが、全公開面の数値比較は未完了である。

## 利用者と一緒に撤去する経路

| 現存経路 | 主な利用者 | 残す先・撤去条件 |
| --- | --- | --- |
| `app-behavior-resolver` の世代1・フック継承、`app-main` の世代別起動 | 既定動作、未移行 MOD | 既定動作と残す MOD が `defineApp` になった時点で分岐・継承を削除。ホストの設定・復旧は起動サービスとして残す |
| `runtime-context` の flat メソッドと namespaced facade、`capabilities` の raw 公開型 | 既定動作、旧 MOD、Dock などのホスト統合 | ユーザーアプリは SDK、ホスト統合は非公開 port へ移す。両方の利用者がなくなった項目からメソッド・型・exports を削除 |
| `RuntimeAudio.say` の `Maybe`、`playAudio` の `boolean`、raw `record`、`useTTS` | 既定動作の録音デモ、AI・応援・ビーコン・Blockly | `say` / `playClip` / `record` / `play` と provider の選択へ移す。呼出側が残る間に変換 shim を増設しない |
| raw button / IMU / headTouch と Timer の直接登録 | 既定動作、Blockly、センサー・通信サンプル | `AppSession` が所有する入力購読・周期処理と、必要なセンサー拡張へ移す。イベント上書き・独自 disposers・petting 判定の重複を削除 |
| miniapp 専用 Compartment と公開 `MiniAppDefinition` | 4つの miniapp、ホストの登録・起動処理 | SDK の UI 拡張で4例を組み直し、専用起動・import 制限・生成による回避・旧 metadata を一緒に撤去 |
| 旧設定名の読み替えと `mod/config` の優先順位 | 旧 MOD、起動処理・設定 UI | SettingsService と SDK 設定・アプリ宣言へ揃える。設定画面からの復旧と適用時点を保持した上で fallback を削除 |
| API 1 / schema 1 の archive 読込・配布 | CLI、SD、WebSerial、Gallery、WASM、Blockly | 残す全生成・配布経路を SDK 世代2へ揃えて旧 archive を起動前に拒否。再生成手順を案内。XS・チップ・能力の検査は保持 |

関連実装: [起動](../../firmware/host/app/app-main.ts)、[context](../../firmware/host/app/runtime-context.ts)、[音声](../../firmware/host/app/runtime-audio.ts)、[miniapp 読込](../../firmware/host/app/experimental-mini-app-loader.ts)、[Blockly](../../web/editor/blocks.mjs)。

ミニゲーム集は [compose.mjs](../../firmware/mods/examples/stackchan_minigames/compose.mjs) が JUMP / CATCH の実装を761行の別ソースへ合成し、Gallery にも写している。理由は miniapp 専用読込の import 制限である。旧読込を拡張して維持する前に、UI 拡張への移行と通常のモジュール参照で、この合成器・合成ソース・配布用コピーを撤去する。ゲームのルール・描画・素材ライセンスは保持する。

## 32例の分類

下表は残す機能から決めた移行方針。「統合」は独立した機能・機種・外部プロトコルを消す意味ではなく、アプリ内の選択肢や拡張へまとめて旧入口を撤去することを指す。単純削除を確定した機能はまだない。未実装の SDK 名は必要な責務を表し、利用可能な公開 API 名ではない。

| 旧例 | 分類・統合先 | 必要な SDK / 保持する機能 | 撤去する経路・現在の状態 |
| --- | --- | --- | --- |
| `ai_stackchan` | 統合 → 対話アプリ | 録音・STT・会話・発話・表情、ボタンで会話 | raw 録音・Dialogue の直接所有・独自 busy。未着手 |
| `ai_stackchan_api` | 統合 → 対話アプリの HTTP 入力 | 上記と HTTP 入力拡張。既存 HTTP 操作を保持 | 重複した対話・表情処理、キーの trace、独自サーバー所有。未着手 |
| `beacon_advertiser` | 統合 → BLE ビーコン例の送信モード | BLE 拡張・素材再生・入力、既存 packet 形式 | TTS 置換・音声レートのアプリ内回避・raw BLE。未着手 |
| `beacon_scanner` | 統合 → BLE ビーコン例の受信モード | BLE 拡張・受信フィルター・素材再生 | 同上。送受信の役割は両方残す。未着手 |
| `calibration` | 統合 → サーボ診断・設定 | SCServo オフセットの読取・書込。通常の姿勢補正と区別 | 実行不能な `_driver._pan/_tilt` と raw polling。現状が未完成なので、正しい校正手順を実機検証するまで移行完了にしない |
| `chat_audioio` | 移行 → 会話アプリ | 全二重会話・provider 選択・画像顔・口同期・入力・UI | 巨大 MOD 内の会話状態・Timer・直接 Piu 操作を分離。未着手 |
| `chatgpt` | 統合 → 対話アプリのテキスト入力 | WebSocket の入力、会話・発話・見回し | 対話3例の重複と独自周期制御。未着手 |
| `cheerup_ble_lite` | 統合 → 応援アプリの BLE 入力 | BLE / motion / 表情 / 素材再生、立上がり検出と平滑化 | BLE / WS で重複する動作・音声待ち・Timer。未着手 |
| `cheerup_ws` | 統合 → 応援アプリの WS 入力 | WebSocket 入力と上記動作。既存ペイロードを保持 | 同上と固定接続先の直書き。未着手 |
| `codex_voice` | 移行 → 遠隔会話アプリ | 会話・USB 音声・headTouch・UI。既存の承認／停止操作を保持 | raw touchPanel・drawer と会話の直接参照。未着手 |
| `dynamixel` | 統合 → サーボ診断・設定 | DYNAMIXEL の ID / モード / 状態確認 | 通常教材からの直接 protocol・UART 所有。機種サポートは残す。未着手 |
| `face` | 移行 → 顔の拡張例 | 表情・色・balloon・emoticon の組合せ | 手動 Timer・Piu effect の直接生成。基本の表情は教材01へ案内。拡張部分は未着手 |
| `face_tracker` | 移行 → UnitV2 追従例 | HTTP 入力拡張・注視、UnitV2 の結果形式 | raw HTTP request と座標変換を入力 adapter へ整理。未着手 |
| `image_avatar_lite` | 移行 → 画像顔の拡張例 | 画像 pack 選択・描画・表情 | 内部 `parts/*` と face controller への依存。未着手 |
| `light` | 統合 → ボード診断の LED 操作 | lighting 拡張・主入力、対応 LED の全モード | raw LED、A/B/C 前提。未着手 |
| `lip_sync` | 移行 → 音量観測の例 | 音声入力のレベル観測・口の開閉 | microphone の `onReadable` 上書き・read/start。録音後の再生教材へ単純統合するとリアルタイム観測が失われるので別機能として残す |
| `local_peer_hello` | 移行 → 端末間通信の例 | ローカル通信・設定・UI、文字数制限と入力検証 | raw Timer と drawer、アプリ外の通信寿命。未着手 |
| `localized_drawer` | 統合 → UI 拡張例 | 言語設定・翻訳・選択 UI | context.i18n / drawer の直接公開。未着手 |
| `look_around` | **移行済み** | SDK 主入力・周期処理・角度による注視 | 旧フック、A/B/C 上書き、Timer、内部 util import を削除。サーボなしの案内と停止を確認。実機は未検証 |
| `m5stackchan_smoke` | 統合 → ボード診断 | サーボ電源とヘッド LED、CoreS3 の診断手順 | 通常アプリの Timer・raw torque 操作。機種固有の確認は保持。未着手 |
| `mcp` | 移行 → MCP 拡張例 | ネットワーク・MCP server・表情・音声・設定 UI | 生の Wi-Fi 状態取得、別所有の server / drawer。未着手 |
| `mediapipe_ble` | 移行 → MediaPipe 追従例 | localPeer、姿勢追従、手の表示。UnitV2 例とは入力・表示が異なる | raw Hands / effect、独自更新 Timer。未着手 |
| `mimic_follow` | 統合 → 姿勢共有例の受信モード | DNS-SD 拡張・motion、既存 TXT 形式 | raw discover と姿勢 I/F。未着手 |
| `mimic_main` | 統合 → 姿勢共有例の送信モード | DNS-SD 拡張・姿勢読取、名前競合の扱い | raw advertise と Timer。送信と受信をどちらも保持。未着手 |
| `mini_app_sample` | 統合 → ミニゲーム集の JUMP | UI 拡張・タップ・フレーム更新・素材 | 単独の旧 miniapp 入口と合成用コピー。ゲーム本体は一箇所に保持。未着手 |
| `mini_app_ui_sample` | 移行 → UI 拡張例 | タッチ UI・画面終了・AppBar との共存 | 専用 MiniAppContext と別起動経路。未着手 |
| `monologue` | **移行済み** | 主入力、自由文は `say`、素材は `playClip` | 旧フック、config による引数の読み替え、A ボタン上書き、内部 util import を削除。音声種別・連打・未対応と WASM 再生を確認。実機は未検証 |
| `setup_rs30x` | 統合 → サーボ診断・設定 | RS30X の ID 設定・角度確認 | 二重の入力代入と `_driver` 依存。ID 書込手順と対応機種を実機確認して移行する |
| `stackchan_catch` | 統合 → ミニゲーム集の CATCH | UI 拡張・タップ・ゲーム状態・描画・素材 | 単独の旧 miniapp 入口と合成用コピー。ゲーム本体は一箇所に保持。未着手 |
| `stackchan_minigames` | 移行 → SDK ミニゲーム集 | JUMP / CATCH の選択と停止 | 合成器、合成済み761行、Gallery コピー、旧 archive 入口を一緒に撤去。未着手 |
| `unit_temperature` | 移行 → センサー拡張例 | SHT3x・周期読取・UI | raw sensor の生成・Timer・drawer。未着手 |
| `web_radio` | 移行 → ラジオアプリ | 音声ストリームの操作・局の選択・設定 | 会話・通常再生と別に物理出力を使う経路、MOD 内の UI と所有。未着手 |

32例のうち SDK への移行実装・自動確認を終えたのは2例。残る30例については分類だけを行った。統合先を新設する際も、アプリごとに同じ接続・停止・状態管理をコピーしない。必要な公開拡張の契約と資源所有を決め、最初の利用者と一緒に実装・検証する。

## 操作の中継と所有の整理

音声の現在の経路は、SDK 呼出し → `AppSession` / `TaskScope` → `AppAudioSession` → `RuntimeAudio` → `OperationQueue` → provider の再生 Session → 機器である。単に層数を減らすだけでは、取消し通知と物理出力の解放完了を取り違える。

| 所有者 | 残す必要のある責務 | 重複削減時に確認すること |
| --- | --- | --- |
| `AppSession` / `TaskScope` | setup・イベント handler・sleep・周期処理と、その終了 | 操作を機能別 Session へ渡すときに、同じ取消し・完了を二重登録していないか |
| `AppAudioSession` | アプリが開始した録音・出力を全て取り消し、実際の解放まで待つ | AppSession の音声用 TaskScope 登録と一つにできるか。閉じる前に別アプリへ資源を渡さないこと |
| `OperationQueue` | 物理入力／出力の順序、上限、停止期限、解放失敗時の再利用禁止 | 会話・Web Radio・USB が同じ物理資源を別の queue で所有していないか |
| provider の再生 Session | HTTP / DNS / decoder / AudioOut / PCM の保持と解放 | 上位の順序制御を再実装せず、開始・停止・解放結果だけを返せるか |

上表は整理対象の特定であり、統合が済んだという意味ではない。今回削除したのは呼出側が存在しない `resolveAppBehaviors`。稼働中の世代分岐を代替名で残したり、新しい互換層を追加したりしていない。

次の実装単位は、既定アプリと UI 拡張を SDK に接続し、上記 miniapp の通常モジュール化と旧入口の撤去を進めること。別系統の資源所有を増やす前に、既存の所有者を使う。初学者受入と実機確認は [F12](firmware-sdk-redesign-progress.md) に従って別に記録する。
