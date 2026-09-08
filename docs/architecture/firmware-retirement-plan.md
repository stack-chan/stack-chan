# 旧経路の撤去とサンプル整理

対象は [実装計画](firmware-sdk-redesign-progress.md) の F5 / F6 / F11。2026-09-08 時点の撤去台帳であり、全項目の完了宣言ではない。残す機能を SDK へ移した実装と、その機能の旧経路を削除した差分を一組として確認する。

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

### Piu 整理後の計測（2026-09-06）

同じ規則で、直前の `30d4864` と今回のコミットに記録したソースを比較した。以下は物理行数で、文書・JSON・画像・archive の容量ではない。

| 分類 | 直前 | 今回 | 差分 |
| --- | ---: | ---: | ---: |
| firmware 実装 | 42,612 | 42,462 | -150 |
| SDK・共通契約 | 428 | 493 | +65 |
| Web 実装 | 16,007 | 16,014 | +7 |
| 型宣言 | 757 | 733 | -24 |
| サンプル・教材（別計上） | 8,305 | 6,554 | -1,751 |
| 開発ツール（別計上） | 4,057 | 4,021 | -36 |
| 試験・補助（別計上） | 36,383 | 36,554 | +171 |
| **製品ソース計** | **59,804** | **59,702** | **−102** |

製品は470ファイルから469ファイルへ1ファイル減った。サンプル・教材の減少1751行のうち1025行は Gallery のコピーを生成出力へ移した分であり、整理の実績から除く。サンプルの整理は残る726行の純減、開発ツールは36行の純減（合成器40行の削除と他の書式調整による4行増）、製品は102行の純減である。これは定義した計測規則でのプログラムソース比較であり、行数だけで設計品質や性能を評価しない。

起点 `6eb4623` に対して製品ソースは、まだ **50ファイル・7,000行増** である。再設計全体の純減条件は未達。新しい配布補助 `canonical-sources.mjs` も、既存の計測規則に従って Web 製品ソースに含めた。

### ホスト起動の整理後の計測（2026-09-06）

直前の `1ac94a8` と今回のソースを、同じ `measure.py` で比較した。

| 分類 | 直前 | 今回 | 差分 |
| --- | ---: | ---: | ---: |
| firmware 実装 | 42,462 | 42,375 | -87 |
| SDK・共通契約 | 493 | 493 | 0 |
| Web 実装 | 16,014 | 16,014 | 0 |
| 型宣言 | 733 | 733 | 0 |
| **製品ソース計** | **59,702** | **59,615** | **-87** |
| 試験・補助（別計上） | 36,554 | 36,405 | -149 |

製品は469ファイルから466ファイルへ3ファイル減った。native/WASMの二重の起動ループとWASM専用の既定動作を共通のホスト起動へまとめ、単一アプリを配列で実行する2つの中継と未使用のWi-Fi復旧ヘルパーを削除した。機能やソースを教材・生成物へ移した削減ではない。試験では古い起動専用stubを削除し、100回の設定・戻る操作と、実WASM上のMOD評価順序を検査する。

起点 `6eb4623` に対しては **47ファイル・6,913行増** であり、全体の純減は未達。既定動作のSDK化、V1のフック継承・世代分岐・raw公開面の撤去は残っている。

### 既定アプリの SDK 化後の計測（2026-09-06）

対象ソースは `77bc4f26e783628169731d094f31791547a55d2b`。直前の `a9d6653` と同じ規則で比較した。

| 分類 | 直前 | 今回 | 差分 |
| --- | ---: | ---: | ---: |
| firmware 実装 | 42,375 | 42,422 | +47 |
| SDK・共通契約 | 493 | 580 | +87 |
| Web 実装 | 16,014 | 16,034 | +20 |
| 型宣言 | 733 | 733 | 0 |
| **製品ソース計** | **59,615** | **59,769** | **+154** |
| サンプル・教材（別計上） | 6,554 | 6,513 | -41 |
| 試験・補助（別計上） | 36,405 | 36,682 | +277 |

製品は466ファイルから471ファイルへ5ファイル増えた。旧既定動作とフック継承を撤去した一方、複数の利用者で共有するUI・入力・lightingのSDKと所有処理を新設したため、合計は154行増えている。サンプルの41行減は、faceのSDK化とlocalized_drawerの単独コード削除による。生成物への移動ではない。

起点 `6eb4623` に対して製品は **52ファイル・7,067行増**。純減条件は未達であり、旧MOD・raw context・設定・会話などの旧経路を利用者と一緒に撤去する必要がある。SDK化や層分けそのものをコード量の改善実績として扱わない。

### ボード診断の統合後の計測（2026-09-06）

対象ソースは `3e69e709bffedb5da70ccfc61e363d314532a5f5`。直前の `77bc4f2` と比較した。

| 分類 | 直前 | 今回 | 差分 |
| --- | ---: | ---: | ---: |
| firmware 実装 | 42,422 | 42,351 | -71 |
| SDK・共通契約 | 580 | 582 | +2 |
| Web 実装 | 16,034 | 16,034 | 0 |
| 型宣言 | 733 | 733 | 0 |
| **製品ソース計** | **59,769** | **59,700** | **-69** |
| サンプル・教材（別計上） | 6,513 | 6,557 | +44 |
| 試験・補助（別計上） | 36,682 | 36,840 | +158 |
| 開発ツール（別計上） | 4,021 | 4,030 | +9 |

製品は471ファイルのまま69行減った。削除対象はflat lighting 4メソッドとled getter、および同じ操作をそこへ渡していたcapability adapter・保持フィールド・型の交差である。ドライバーやLEDの機能はSDKと残るBlocklyの名前空間から引き続き使う。型・コメントを伴うAPIの撤去であり、コメントだけを削った成果ではない。旧2例は1例に統合したが、メニューや失敗処理を追加したためサンプルの行数は増えている。

起点からは **52ファイル・6,998行の製品純増** で、純減条件は未達。未移行の利用者・旧名前空間・全公開入口と中継の計測・設定と会話の重複を引き続き整理する。

### flat context の撤去後の計測（2026-09-06）

対象ソースは `d1f3ca64b1413ad2d99e381454283c97ff734372`。直前 `3e69e70` に対し、firmware実装は42,351行から42,128行へ223行減少した。SDK・Web・型宣言は同じで、製品計は471ファイル・59,477行。試験・補助は33行増えた。

| このclassのTypeScript公開インスタンス宣言 | 直前 | 今回 |
| --- | ---: | ---: |
| 起動と名前空間・機能getter | 12 | 12 |
| audio / motion / face / input / drawer のflat別名 | 24 | 0 |
| **計** | **36** | **12** |

flatの24個は16メソッド・8getterである。SDKの顔・吹き出しportや旧名前空間の呼出しは、contextの別名を経由せず既存runtimeへ渡す。前回のLEDと合わせた29個について、実XSのcontextにそのプロパティが存在しないことを検査した。補助の公開型4個も撤去した。上表はruntime-context一つのTypeScript宣言の計測で、SDKや拡張を含む全公開面の数ではない。

型・コメントを伴う公開入口の撤去であり、教材や生成物への付け替え、コメントだけの削除を削減として扱っていない。3つのnative releaseバイナリーも直前よりそれぞれ4,096 bytes小さくなった。起点からはなお **52ファイル・6,775行増** で、全体の純減は未達。旧名前空間・raw型・設定・会話の利用者を引き続き移行する。

## 利用者と一緒に撤去する経路

| 現存経路 | 主な利用者 | 残す先・撤去条件 |
| --- | --- | --- |
| `app-behavior-resolver` の世代1、`app-main` の世代別起動 | 未移行 MOD | 既定動作は SDK / AppSession へ移行し、フック継承を撤去済み。残す MOD と Blockly が `defineApp` になった時点で世代分岐を削除 |
| `runtime-context` の旧 namespaced facade、`capabilities` の raw 公開型 | 旧 MOD、Dock などのホスト統合 | flat の29入口は撤去済み。ユーザーアプリは SDK、ホスト統合は非公開 port へ移し、残る旧名前空間・型・exports を利用者と一緒に削除 |
| `RuntimeAudio.say` の `Maybe`、`playAudio` の `boolean`、raw `record`、`useTTS` | AI・応援・ビーコン・Blockly | `say` / `playClip` / `record` / `play` と provider の選択へ移す。呼出側が残る間に変換 shim を増設しない |
| raw button / IMU / headTouch と Timer の直接登録 | Blockly、センサー・通信サンプル | 既定動作は AppSession 所有の購読・周期処理へ移行済み。残る利用者を入力・センサー拡張へ移し、raw 公開面を削除 |
| miniapp 専用起動・公開型 | **撤去済み**。旧4例をSDKの2パッケージへ整理 | 通常の AppSession に画面登録を接続。専用 Compartment・登録関数・attenuated Piu module・型の複製を削除。内部 viewport / registry はホストの画面管理として残す |
| 旧設定名の読み替えと `mod/config` の優先順位 | 旧 MOD、起動処理・設定 UI | SettingsService と SDK 設定・アプリ宣言へ揃える。設定画面からの復旧と適用時点を保持した上で fallback を削除 |
| API 1 / schema 1 の archive 読込・配布 | CLI、SD、WebSerial、Gallery、WASM、Blockly | 残す全生成・配布経路を SDK 世代2へ揃えて旧 archive を起動前に拒否。再生成手順を案内。XS・チップ・能力の検査は保持 |

関連実装: [起動](../../firmware/host/app/app-main.ts)、[context](../../firmware/host/app/runtime-context.ts)、[音声](../../firmware/host/app/runtime-audio.ts)、[Piu 拡張](../../firmware/sdk/extensions/piu.ts)、[Blockly](../../web/editor/blocks.mjs)。

ミニゲーム集は `jump.ts` / `catch.ts` を正本とし、`mod.ts` から通常の相対 import で読み込む。旧単独 archive 2つ、761行の合成ソースと40行の合成器を削除した。ゲームのルール・描画・素材・ライセンスは保持する。Gallery では維持していたソースコピーを撤去し、Vite がこの正本を変更せず公開用 `source/` へコピーする。配布先の metadata 参照だけを manifest で差し替える。

Gallery の1025行の追跡ソースを生成出力へ移した分は、実装の機能削減や製品コード量削減の成果に数えない。実体として撤去したものは、独立した旧起動経路、同じゲームをもう一度合成・維持していたソースと合成器、型宣言の複製である。

Piu 拡張は基本 SDK の import・型検査から分ける。型の正本は `firmware/sdk` の npm workspace で、MOD の TypeScript ビルドでも同じソースを解決する。通常の MOD と同じ realm を使うため、旧 Compartment の import/global 制限は維持しない。公開コンストラクターを表示部品に絞る設計と、未信頼コードの隔離は別の問題として明記する。描画・停止・viewport という機能は保持する。

## 32例の分類

下表はソース移行・統合後の状態。「統合」は役割を同じアプリにまとめて旧入口を撤去したことを指す。必要な通信形式・機器・素材を維持し、サーボの永続設定は明示操作へ変更した。実機受入は別に必要である。

| 旧例 | 分類・統合先 | 必要な SDK / 保持する機能 | 撤去する経路・現在の状態 |
| --- | --- | --- | --- |
| `ai_stackchan` | **統合済み** → [conversation](../../firmware/mods/examples/conversation/README_ja.md) | 録音・STT・会話・発話・表情、ボタンで会話 | 旧入口・直接生成・raw操作をSDKへ移し、役割の重複を削除。host API 7。実機・初学者は未受入 |
| `ai_stackchan_api` | **統合済み** → [conversation](../../firmware/mods/examples/conversation/README_ja.md) | 上記と HTTP 入力拡張。既存 HTTP 操作を保持 | 旧入口・直接生成・raw操作をSDKへ移し、役割の重複を削除。host API 7。実機・初学者は未受入 |
| `beacon_advertiser` | **統合済み** → [beacon](../../firmware/mods/examples/beacon/README_ja.md) | BLE 拡張・素材再生・入力、既存 packet 形式 | 旧入口・直接生成・raw操作をSDKへ移し、役割の重複を削除。host API 7。実機・初学者は未受入 |
| `beacon_scanner` | **統合済み** → [beacon](../../firmware/mods/examples/beacon/README_ja.md) | BLE 拡張・受信フィルター・素材再生 | 旧入口・直接生成・raw操作をSDKへ移し、役割の重複を削除。host API 7。実機・初学者は未受入 |
| `calibration` | **統合済み** → [servo_diagnostics](../../firmware/mods/examples/servo_diagnostics/README_ja.md) | SCServo オフセットの読取・書込。通常の姿勢補正と区別 | 旧入口・直接生成・raw操作をSDKへ移し、役割の重複を削除。host API 7。実機・初学者は未受入 |
| `chat_audioio` | **移行済み** → [chat_audioio](../../firmware/mods/examples/chat_audioio/README_ja.md) | 全二重会話・provider選択・口同期・入力・共通UI | 旧入口・直接生成・raw操作をSDKへ移し、役割の重複を削除。host API 7。実機・初学者は未受入 |
| `chatgpt` | **統合済み** → [conversation](../../firmware/mods/examples/conversation/README_ja.md) | WebSocket の入力、会話・発話・見回し | 旧入口・直接生成・raw操作をSDKへ移し、役割の重複を削除。host API 7。実機・初学者は未受入 |
| `cheerup_ble_lite` | **統合済み** → [cheerup](../../firmware/mods/examples/cheerup/README_ja.md) | BLE / motion / 表情 / 素材再生、立上がり検出と平滑化 | 旧入口・直接生成・raw操作をSDKへ移し、役割の重複を削除。host API 7。実機・初学者は未受入 |
| `cheerup_ws` | **統合済み** → [cheerup](../../firmware/mods/examples/cheerup/README_ja.md) | WebSocket 入力と上記動作。既存ペイロードを保持 | 旧入口・直接生成・raw操作をSDKへ移し、役割の重複を削除。host API 7。実機・初学者は未受入 |
| `codex_voice` | **移行済み** → [codex_voice](../../firmware/mods/examples/codex_voice/README_ja.md) | 会話・USB 音声・headTouch・UI。既存の承認／停止操作を保持 | 旧入口・直接生成・raw操作をSDKへ移し、役割の重複を削除。host API 7。実機・初学者は未受入 |
| `dynamixel` | **統合済み** → [servo_diagnostics](../../firmware/mods/examples/servo_diagnostics/README_ja.md) | DYNAMIXEL の ID / モード / 状態確認 | 旧入口・直接生成・raw操作をSDKへ移し、役割の重複を削除。host API 7。実機・初学者は未受入 |
| `face` | **移行済み** → UI 拡張例 | 表情・色・balloon・emoticon と翻訳メニュー | SDK の UI 拡張と所有された周期処理へ移行。手動 Timer・Piu effect の直接生成を削除。配置・フォントはホストの共通表示を使用 |
| `face_tracker` | **移行済み** → [face_tracker](../../firmware/mods/examples/face_tracker/README_ja.md) | HTTP 入力拡張・注視、UnitV2 の結果形式 | 旧入口・直接生成・raw操作をSDKへ移し、役割の重複を削除。host API 7。実機・初学者は未受入 |
| `image_avatar_lite` | **移行済み** → 画像顔の拡張例 | 6キャラクター・12表情・43画像と配置 | SDK UIへ移行。グローバル登録・ID検索の暗黙fallback・`ui.avatar` とサンプルの内部 `parts/*` 依存を撤去。目と口の画像名・サイズの二重指定も削除。実機・初学者は未受入 |
| `light` | **統合済み** → `board_diagnostics` | LED の色・点滅・虹・消灯、利用できる主入力とメニュー | raw LED とボタン代入を削除。複数のLED名を選び、アプリ終了で全使用LEDを消灯。実機は未受入 |
| `lip_sync` | **移行済み** → [lip_sync](../../firmware/mods/examples/lip_sync/README_ja.md) | 音声入力のレベル観測・口の開閉 | 旧入口・直接生成・raw操作をSDKへ移し、役割の重複を削除。host API 7。実機・初学者は未受入 |
| `local_peer_hello` | **移行済み** → [local_peer_hello](../../firmware/mods/examples/local_peer_hello/README_ja.md) | ローカル通信・設定・UI、文字数制限と入力検証 | 旧入口・直接生成・raw操作をSDKへ移し、役割の重複を削除。host API 7。実機・初学者は未受入 |
| `localized_drawer` | **統合済み** → `face` | 翻訳メニュー・三言語の辞書 | 辞書を face へ集約し、SDK の localize / addAction へ移行。旧プログラムと単独 archive の manifest を削除 |
| `look_around` | **移行済み** | SDK 主入力・周期処理・角度による注視 | 旧フック、A/B/C 上書き、Timer、内部 util import を削除。サーボなしの案内と停止を確認。実機は未検証 |
| `m5stackchan_smoke` | **統合済み** → `board_diagnostics` | サーボの小さい往復・トルク解放・CoreS3 head LED・自動診断 | raw Timer / torque / 秒単位の姿勢をSDKへ移行。旧入口を削除しUSB診断runnerを更新。実機は未受入 |
| `mcp` | **移行済み** → [mcp](../../firmware/mods/examples/mcp/README_ja.md) | ネットワーク・MCP server・表情・音声・設定 UI | 旧入口・直接生成・raw操作をSDKへ移し、役割の重複を削除。host API 7。実機・初学者は未受入 |
| `mediapipe_ble` | **移行済み** → [mediapipe_ble](../../firmware/mods/examples/mediapipe_ble/README_ja.md) | localPeer、姿勢追従、手の表示。UnitV2 例とは入力・表示が異なる | 旧入口・直接生成・raw操作をSDKへ移し、役割の重複を削除。host API 7。実機・初学者は未受入 |
| `mimic_follow` | **統合済み** → [pose_sharing](../../firmware/mods/examples/pose_sharing/README_ja.md) | DNS-SD 拡張・motion、既存 TXT 形式 | 旧入口・直接生成・raw操作をSDKへ移し、役割の重複を削除。host API 7。実機・初学者は未受入 |
| `mimic_main` | **統合済み** → [pose_sharing](../../firmware/mods/examples/pose_sharing/README_ja.md) | DNS-SD 拡張・姿勢読取、名前競合の扱い | 旧入口・直接生成・raw操作をSDKへ移し、役割の重複を削除。host API 7。実機・初学者は未受入 |
| `mini_app_sample` | **統合済み** → ミニゲーム集の JUMP | UI 拡張・タップ・フレーム更新・素材 | 単独の旧入口・重複素材を削除。`jump.ts` / `catch.ts` に正本を集約。ルールとライセンスは保持 |
| `mini_app_ui_sample` | **移行済み** → UI 拡張例 | タッチ UI・画面終了・AppBar との共存 | `mod.ts` / `screen.ts` を SDK の Piu 拡張へ移行。選択・通知・説明・終了を保持 |
| `monologue` | **移行済み** | 主入力、自由文は `say`、素材は `playClip` | 旧フック、config による引数の読み替え、A ボタン上書き、内部 util import を削除。音声種別・連打・未対応と WASM 再生を確認。実機は未検証 |
| `setup_rs30x` | **統合済み** → [servo_diagnostics](../../firmware/mods/examples/servo_diagnostics/README_ja.md) | RS30X の ID 設定・角度確認 | 旧入口・直接生成・raw操作をSDKへ移し、役割の重複を削除。host API 7。実機・初学者は未受入 |
| `stackchan_catch` | **統合済み** → ミニゲーム集の CATCH | UI 拡張・タップ・ゲーム状態・描画・素材 | 単独の旧入口・重複素材を削除。`jump.ts` / `catch.ts` に正本を集約。ルールとライセンスは保持 |
| `stackchan_minigames` | **移行済み** → SDK ミニゲーム集 | JUMP / CATCH の選択と停止 | 合成器・761行の合成ソース・追跡していた Gallery コピー・旧入口を撤去。配布ソースと archive を再生成 |
| `unit_temperature` | **移行済み** → [unit_temperature](../../firmware/mods/examples/unit_temperature/README_ja.md) | SHT3x・周期読取・UI | 旧入口・直接生成・raw操作をSDKへ移し、役割の重複を削除。host API 7。実機・初学者は未受入 |
| `web_radio` | **移行済み** → [web_radio](../../firmware/mods/examples/web_radio/README_ja.md) | 音声ストリームの操作・局の選択・設定 | 旧入口・直接生成・raw操作をSDKへ移し、役割の重複を削除。host API 7。実機・初学者は未受入 |

元の32例はSDKの21パッケージへ移行・統合済みで、API 1の実行例は0件。各例の旧コードは撤去したが、V1ホスト／Blockly／provider-dialoguesの参考実装は残る。後者はMOD宣言と実行入口を持つアプリではない。物理機器・外部サービスと初学者の受入、製品ソース純減は未達。[契約・検証・今回のコード量](sdk-example-migration-2026-09-08.md)を参照する。

## 操作の中継と所有の整理

音声の現在の経路は、SDK 呼出し → `AppSession` / `TaskScope` → `AppAudioSession` → `RuntimeAudio` → `OperationQueue` → provider の再生 Session → 機器である。単に層数を減らすだけでは、取消し通知と物理出力の解放完了を取り違える。

| 所有者 | 残す必要のある責務 | 重複削減時に確認すること |
| --- | --- | --- |
| `AppSession` / `TaskScope` | setup・イベント handler・sleep・周期処理と、その終了 | 操作を機能別 Session へ渡すときに、同じ取消し・完了を二重登録していないか |
| `AppAudioSession` | アプリが開始した録音・出力を全て取り消し、実際の解放まで待つ | AppSession の音声用 TaskScope 登録と一つにできるか。閉じる前に別アプリへ資源を渡さないこと |
| `OperationQueue` | 物理入力／出力の順序、上限、停止期限、解放失敗時の再利用禁止 | 会話・Web Radio・USB が同じ物理資源を別の queue で所有していないか |
| provider の再生 Session | HTTP / DNS / decoder / AudioOut / PCM の保持と解放 | 上位の順序制御を再実装せず、開始・停止・解放結果だけを返せるか |

上表は整理対象の特定であり、統合が済んだという意味ではない。これまでに削除したものは、呼出側が存在しなかった `resolveAppBehaviors` と、旧 miniapp 用の loader / registration / attenuated Piu module、準備 callback を渡すだけになった `prepareAppLaunch`。稼働中の世代分岐を代替名で残したり、新しい互換層を追加したりしていない。

次の実装単位は、残る22例と Blockly の利用者を SDK へ移し、対応する旧フック・raw context・会話と設定の重複を撤去すること。別系統の資源所有を増やす前に、既存の所有者を使う。初学者受入と実機確認は [F12](firmware-sdk-redesign-progress.md) に従って別に記録する。
