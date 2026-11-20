# firmware 再設計レビュー修正計画

作成日：2026-07-02

対象：`REVIEW_firmware-rearch_ja.md` の全指摘。

この文書は、レビューで確認された不具合、設計負債、重複、効率問題、検証不足を、マージ可能な単位へ分解して修正するための計画である。

## 品質基準

この修正では、次の基準を満たす。

- **利用者可視の回帰を先に止める**：タッチ、注視追従、Wi-Fi、録音、TTS、顔表示、wasm ビルドを最初の修正単位に入れる。
- **silent failure を残さない**：タイムアウト、録音失敗、TTS 失敗、Wi-Fi 失敗、未対応 capability は、boolean、reject、throw、trace のどれで伝えるかを契約で定める。
- **型で契約を固定する**：`unknown`、二重 cast、duck typing、内部 import に依存する経路を減らし、公開 capability を `satisfies` とテストで検証する。
- **プラットフォーム差分は manifest か provider に閉じる**：default behavior と app 層へ wasm 専用、CoreS3 専用、カメラ専用の都合を漏らさない。
- **修正は観測可能にする**：各修正に unit test、architecture check、wasm build、実機 smoke のいずれかを対応させる。
- **互換性の破壊は移行処理を伴う**：Preference domain、MOD 公開 API、web console 入力は、旧名の読み取りか移行を用意してから新名へ寄せる。

## 実行順序

修正は 7 段階で行う。

段階 1 はマージブロッカーを解消する。

段階 2 は残りの確認済みバグを解消する。

段階 3 は公開契約とライフサイクルを整理する。

段階 4 は UI の状態配布と拡張点を固める。

段階 5 は audio と conversation の重複とエラー処理を統一する。

段階 6 は motion と protocol の信頼性を上げる。

段階 7 は性能、重複、CI、architecture check を整理する。

各段階は独立 PR にできる粒度へ分ける。

ただし、段階 1 の #1 から #6 は同じブランチで連続して処理し、CI を緑に戻してから後続へ進む。

## 段階 0：作業前の固定

- [x] `REVIEW_firmware-rearch_ja.md` の各指摘に追跡 ID を付け、修正 PR の description から参照できるようにする。
- [x] 現在の `develop` merge-base、作業ブランチ HEAD、未コミット差分の status を記録する。
- [x] `npm run format`、`npm run lint`、`npm run test:unit`、`npm run check:architecture`、`npm run build:wasm` の現状結果を記録する。
- [x] 実機検証対象を CoreS3、wasm、lin に分ける。
- [x] `profile.png`、`stackchan.png` など生成物やデバッグ成果物がコミット対象に混ざらないように整理する。

作業状態メモ：

- 作業ブランチは `refactor/rearch` である。
- 作業開始時点の HEAD は `d59cfd21d5e7bb4d3c2ad6cbe137eaffa74ea295` である。
- `develop` との merge-base は `276f479184d37b23bb7b6844438d0f6cf07b7473` である。
- 未コミット差分は `git status --short` で 186 件である。
- `firmware/profile.png` と `firmware/stackchan.png` は生成物として `.gitignore` に追加し、修正コミットの対象外にする。

検証状態メモ：

- `npm run format:fix && npm run lint` は通過している。
- `npm run test:unit` は 124 tests、2 suites で通過している。
- `npm run check:architecture` は 74 tests、3 suites で通過している。
- `npm run build:wasm` は通過している。
- wasm simulator の CDP smoke は `index.html`、`simulator.mjs`、`mc.js`、`mc.wasm` の 200 応答、`[main] app behaviors ready`、320x240 canvas の `alpha=76800`、`exceptionCount=0` を確認している。
- wasm simulator の CDP smoke は 3.5 秒間隔の canvas hash が `2870238757` から `784282277` へ変化し、face animation が動いていることを確認している。
- wasm simulator の CDP smoke は face touch から drawer open、Look toggle、`looking at:` trace、`WasmDriver.applyRotation`、camera preview render まで確認している。
- `npm run build:m5stackchan_cores3` は通過している。
- `npm run check:legacy-names` は `No legacy names found.` で通過している。
- `npm run test:moddable` は全 29 Moddable test manifest で通過している。
- `npm run smoke:lin` は `mcsim` が 10 秒生存し、`app behaviors ready` まで到達している。
- `npm run build --target=esp32/m5stack` は今回の merge gate から外す。
- 除外前の確認では `xs_esp32.bin` が `0x3a7080` bytes、factory partition が `0x3a0000` bytes で `0x7080` bytes 超過していた。

実機と smoke の対象分割：

- M5Stack 系の実機 smoke は今回の target から外す。
- CoreS3 は touch 復旧ログを証跡として残し、drawer、lookAt、record、TTS error recovery、Wi-Fi with MOD の一括実機 smoke は別 issue へ送る。
- legacy `esp32/m5stack` は今回の target から外し、サイズ削減または partition 方針決定を別 issue へ送る。
- wasm は起動、face rendering、face animation、drawer、Look toggle、camera preview を CDP smoke で見る。
- wasm の microphone error、playAudio、preference update は unit test と contract test を今回の gate にし、ブラウザ操作 smoke は follow-up に残す。
- lin は `npm run smoke:lin` で host app の起動経路を確認する。

完了条件：

- [x] 以後の修正が、どのレビュー指摘を閉じるものか一意に追跡できる。
- [x] 既存の未コミット差分を誤って巻き戻さない作業状態になっている。

## 段階 1：マージブロッカーの解消

### R1：タッチ入力を復旧し、ポーリング負荷を入力モジュールへ閉じる

対象指摘：#1。

設計方針：

`compose.ts` は `Touch` と `TouchPanel` の配線だけを担当する。

ポーリング間隔、active 時の短周期化、release debounce、platform 固有の INT 扱いは input driver または platform provider へ閉じる。

CoreS3 は GPIO21 のエッジ割り込みに依存せず、M5GFX と同じ polling mode を platform provider で扱う。

実装チェックリスト：

- [x] `compose.ts` の `touch = undefined` と `touchPanel = undefined` を撤去する。
- [x] `config.Touch` がある場合だけ `new Touch(config.Touch)` を作る。
- [x] `config.TouchPanel` がある場合だけ `new TouchPanel(config.TouchPanel)` を作る。
- [x] `config.touchIntervalMs`、`config.touchIdleIntervalMs`、`config.touchActiveIntervalMs`、`config.touchReleaseDebounceMs` の責務を input 側に寄せる。
- [x] CoreS3 provider は FT6x06 を polling mode に設定し、`GPIO21` の edge callback を必須にしない。
- [x] `context.touch` と `context.touchPanel` が undefined になる条件を capability 型と docs に明記する。
- [x] `config` import が未使用にならない状態にする。

検証チェックリスト：

- [x] fake timer で transient empty sample が `ended` を誤発火しないことを unit test で確認する。
- [x] `on-context-created.ts` の petting 処理が touch sample で発火することを unit test または integration test で確認する。
- [x] camera preview 中に `touchPanel.pause()` と `touchPanel.resume()` が呼ばれることをテストする。
- [x] CoreS3 実機では、ユーザー提供ログで face touch、drawer open、overlay close が反応することを確認している。
- [x] petting と idle 時 touch polling ログ量の実機確認は、M5Stack 系実機 smoke を今回 target から外したため follow-up に分類する。

完了条件：

- [x] タッチ機能が全 platform で無条件に無効化されていない。
- [x] CPU 回帰対策が app composition のハードコードではなく input 層の設定として表現されている。

### R2：注視追従を復旧し、姿勢更新を需要駆動にする

対象指摘：#2。

設計方針：

`MotionController` は `lookAt()` で gaze point が設定されたときだけ pose update timer を動かす。

gaze point が解除され、補間中の movement も無ければ timer を止める。

実装チェックリスト：

- [x] `Timer.repeat(this.updatePose, INTERVAL_POSE)` の単純復旧ではなく、start と stop を `MotionController` 内部に隠蔽する。
- [x] `lookAt(point)`、`lookAt(undefined)`、`moveTo()`、`close()` の timer 状態遷移を定義する。
- [x] `updatePose()` が timer から呼ばれても手動で呼ばれても同じ結果になるようにする。
- [x] `pose.body.rotation` が stale にならないように、driver の現在角度取得と gaze 補正の順序を固定する。

検証チェックリスト：

- [x] fake timer で `lookAt()` 後にサーボ target が更新されることを確認する。
- [x] gaze point 解除後に timer が止まることを確認する。
- [x] `drawer` の Look トグルで gaze 更新が発火することを wasm CDP smoke で確認する。
- [x] `look_around` と `face_tracker` の sample MOD smoke は、M5Stack 系実機 smoke target-out と MOD smoke 分離により follow-up に分類する。

完了条件：

- [x] 注視追従が復旧している。
- [x] CPU 回帰を避けるための停止条件がテストで固定されている。

### R3：MOD 有効時も Wi-Fi 基盤を起動する

対象指摘：#3。

設計方針：

Wi-Fi 接続、SNTP、PreferenceServer、設定画面に必要な host 基盤は product default behavior ではなく boot service として扱う。

installed MOD は product behavior を置換してよいが、host boot service まで置換しない。

実装チェックリスト：

- [x] `connectStoredWiFi()` を `default-behavior/on-launch.ts` から host 起動シーケンスへ移す。
- [x] MOD の `onLaunch` より前に Wi-Fi 接続開始を行う。
- [x] network 必須 MOD が接続完了を待てる capability を設計する。
- [x] 接続失敗時の trace を復旧する。
- [x] fire-and-forget を維持する場合は、`network.ready` の Promise または状態購読を公開する。
- [x] default behavior が内部 `network-manager` を直接 import しなくて済む公開 API を用意する。

検証チェックリスト：

- [x] MOD 存在時も保存済み SSID へ接続を試みる unit test を追加する。
- [x] `chatgpt`、`ai_stackchan`、`cheerup_ws`、MCP 系 MOD の smoke は、Wi-Fi credential と外部 service を前提にするため follow-up に分類する。
- [x] Wi-Fi 未設定時の `No Wi-Fi SSID` trace が残ることを確認する。
- [x] Wi-Fi 接続失敗時に無表示で失敗しないことを確認する。

完了条件：

- [x] MOD の置換規則を維持しながら、host 基盤機能が消えない。

### R4：wasm manifest の app module 欠落を修正する

対象指摘：#4。

設計方針：

app module の列挙は `host/app/manifest.json` と wasm manifest で二重管理しない。

共通 include か architecture check により、app import graph の必須 module が platform manifest から漏れないようにする。

実装チェックリスト：

- [x] wasm manifest に `../../app/app-behavior-resolver` を追加する。
- [x] `host/app/manifest.json` と `host/platforms/wasm/manifest.json` の app module 差分を検査する architecture check を追加する。
- [x] 共通 include 化は相対 path 基準が異なるため見送り、architecture check で app module 同期を固定する。
- [x] CI に `npm run build:wasm` を追加する。

検証チェックリスト：

- [x] `npm run build:wasm` が成功する。
- [x] `web` simulator が生成された `mc.js` と `mc.wasm` を読み込める。
- [x] wasm simulator の unit または smoke が existing flow と同じ entry を通る。

完了条件：

- [x] wasm build の module 解決失敗を CI で再発防止できる。

### R5：Preference domain `renderer` から `ui` への移行を実装する

対象指摘：#5。

設計方針：

新ファームは `ui` を正とする。

ただし、既存 flash と web console は `renderer` を使っているため、読み取り互換または一度だけの移行処理を用意する。

実装チェックリスト：

- [x] `preferences` module に `renderer` から `ui` への migration を追加する。
- [x] `ui` に値が無く `renderer` に値がある場合だけ旧値を採用する。
- [x] 採用後に `ui` へ書き戻す方針に決める。
- [x] `web/preference/index.html` を `ui.type` 送信へ更新する。
- [x] 旧 `renderer.type` の送信を受けても壊れない互換処理を残す。
- [x] migration の trace は一度だけ出す。

検証チェックリスト：

- [x] 旧 `renderer.type='dog'` が新ファームで顔設定に反映されることを unit test で確認する。
- [x] `ui.type` が既にある場合は `renderer.type` で上書きしないことを確認する。
- [x] web console が `ui.type` を送ることを architecture check で確認する。

完了条件：

- [x] 既存デバイスの顔設定が silent に `simple` へ戻らない。
- [x] web console と firmware の domain 名が一致している。

### R6：architecture check を現在の smoke 手順へ合わせる

対象指摘：#6。

設計方針：

ドキュメント文字列の正規表現一致ではなく、smoke 手順が実行可能な script 名または manifest path を参照していることを検査する。

実装チェックリスト：

- [x] `platform-manifest.architecture.ts` の smoke doc 検査を `npm run build:m5stackchan_cores3` に合わせる。
- [x] `package.json` の script 定義を読み、docs 内のコマンドと照合する。
- [x] 正規表現はコマンド断片ではなく script 名の存在確認に寄せる。

検証チェックリスト：

- [x] `npm run check:architecture` が成功する。
- [x] smoke doc のコマンドを壊すと architecture check が失敗する。

完了条件：

- [x] CI の architecture check が赤にならない。

### R7：`Microphone.record()` の 2 回目以降失敗を修正する

対象指摘：#7。

設計方針：

recording flag の所有者は `Microphone.record()` であり、resolve、reject、close の全経路で確実に戻す。

実装チェックリスト：

- [x] chunk 枯渇時の resolve 前に `recording = false` を設定する。
- [x] buffer 満杯時の resolve 前に `recording = false` を設定する。
- [x] error と close 経路でも `recording = false` を保証する。
- [x] `finish()` / `fail()` helper へまとめる。

検証チェックリスト：

- [x] `record()` を連続 2 回呼べる unit test を追加する。
- [x] 録音中の 2 回目呼び出しだけ `already recording` になることを確認する。
- [x] drawer の「Record and playback」を 2 回連続で押す実機 smoke は、M5Stack 系実機 smoke target-out により follow-up に分類する。

完了条件：

- [x] 録音が 1 起動 1 回に制限されない。

### R8：後から追加したバルーンとエフェクトへ現在の顔状態を再配布する

対象指摘：#8。

設計方針：

`setFace` と同じ rehydrate pattern を `addEffect` と `showBalloon` に適用する。

`faceStatesEqual` による早期 return は既存 content への不要配布だけを省き、新規 content の初期化を妨げない。

実装チェックリスト：

- [x] `FaceView` が最後に適用した faceState と palette を保持する。
- [x] `addEffect()` 直後に新規 effect へ `onFaceState` を送る。
- [x] `showBalloon()` 直後に balloon へ palette と faceState を送る。
- [x] 既存 content 全体への再配布を避け、新規 content だけを初期化する。

検証チェックリスト：

- [x] `setColor()` 後、発話なしで `showBalloon('moving...')` してもテーマ色が反映されることを unit test で確認する。
- [x] effect 追加直後に現在の emotion と palette が反映されることを確認する。
- [x] `faceStatesEqual` の hot path が不要に破壊されていないことを architecture check または allocation test で確認する。

完了条件：

- [x] 状態変化が無い期間に追加した UI content が初期テーマを取りこぼさない。

### R9：TTS エラー時の口閉じと streaming flag を共通化する

対象指摘：#9。

設計方針：

TTS engine ごとに AudioOut lifecycle を手書きしない。

共通 helper が `streaming`、`onDone`、`onError`、AudioOut close、同期 throw cleanup を担保する。

実装チェックリスト：

- [x] audio module に `createTTSPlaybackLifecycle` のような共通 helper を追加する。
- [x] 6 デバイス TTS engine を helper 経由に置き換える。
- [x] streamer コンストラクタが同期 throw しても `streaming = false` へ戻す。
- [x] `onError` 経路でも `onDone` または口閉じ callback が必ず走るようにする。
- [x] エラー時に `onDone()` の後で `callback(error)` を呼ぶ順序を定義する。
- [x] 二重 close と二重 callback を防ぐ idempotent cleanup にする。

検証チェックリスト：

- [x] TTS streaming 中に error を発生させ、口が閉じることを unit test で確認する。
- [x] streamer constructor throw 後に次の `say()` が `already playing` にならないことを確認する。
- [x] 全 TTS engine が lifecycle helper を使うことを architecture check で確認する。

完了条件：

- [x] TTS 失敗後に口と engine state が固着しない。
- [x] 6 engine の lifecycle 重複がなくなる。

### R10：`playAudio` capability の契約を実態へ合わせる

対象指摘：#10。

設計方針：

全ターゲットで提供する capability は、全ターゲットで意味のある動作をする。

デバイス側で実装しないなら、capability を optional にするか、明示的な unsupported error を返す。

実装チェックリスト：

- [x] device 版 `tone.ts` に unsupported を返す `play()` を実装する。
- [x] `playAudio(): Promise<boolean>` の boolean の意味を定義する。
- [x] unsupported を `false` として呼び出し元へ返す。
- [x] MOD 作者向け docs に成功、失敗、未対応の扱いを書く。

検証チェックリスト：

- [x] wasm で `playAudio` が成功することを unit test で確認する。
- [x] device で `playAudio` が unsupported として観測可能に失敗することを実装で固定する。
- [x] capability 型が実装と一致することを architecture check で確認する。

完了条件：

- [x] 公開 API が実態を偽らない。

## 段階 2：中低優先の確認済み問題

### R11：camera capture の初回フレーム待ちを実装する

対象指摘：#11。

- [x] `start()` 直後の `capture()` は、初回フレーム到達まで Promise または retry で待つ。
- [x] timeout を設け、カメラ未接続と初回待ちを区別する。
- [x] preview が一度の `undefined` で `camera unavailable` へ固定されないことを test する。

### R12：`useUI()` 後の drawer behavior 参照を更新する

対象指摘：#12。

- [x] `runtime-ui.ts` の `#drawerBehavior` を application 交換時に再取得する。
- [x] `removeDrawerButton` が現在の application へ作用することを test する。
- [x] 古い application に対する副作用が残らないことを確認する。

### R13：wasm microphone の録音エラーを伝搬する

対象指摘：#13。

- [x] bridge が書く error message を JS 側で読む。
- [x] `status < 0` では空 ArrayBuffer resolve ではなく reject する。
- [x] browser permission denied と device error を区別できる message にする。
- [x] wasm microphone の error unit test を追加する。

### R14：face coordinates 更新で width と height を保持する

対象指摘：#14。

- [x] `face.coordinates = { left, top }` の全置換をやめる。
- [x] 既存の `coordinates` を保持し、`left` と `top` だけを更新する。
- [x] タッチ判定領域が face サイズを失わないことを test する。

### R15：未バインド content の `container.start?.()` を `onDisplaying` へ移す

対象指摘：#15。

- [x] `FaceBehavior.onCreate` の clock start を削除する。
- [x] `onDisplaying` で start する。
- [x] `onFinished` または `onUndisplaying` で stop する。
- [x] simulator で face animation が起動することを CDP smoke で確認する。

### R16：Dynamixel 既存バグを別 commit で修正する

対象指摘：#16。

この指摘は branch 起因ではないが、レビューで確認済みのバグとして修正対象に入れる。

- [x] `values[0] & 0x8000` を正しい byte width の判定へ修正する。
- [x] `setOffsetAngle` の逆変換式を仕様書に合わせて修正する。
- [x] 4 byte 要求 2 byte 使用の register read を仕様に合わせる。
- [x] 既存挙動に依存する sample があれば補正する。
- [x] protocol fixture を追加し、符号付き角度、offset、read length を test する。

### R17：write command timeout を silent success にしない

対象指摘：#17。

- [x] protocol 共通の timeout error 型を定義する。
- [x] dynamixel、rs30x、scservo の write timeout を reject または callback error へ変える。
- [x] 上位 motion API が timeout を握り潰さないようにする。
- [x] trace だけで成功扱いになる経路を test で禁止する。

### R18：`manifest_local.json` の private config 除去を文書化する

対象指摘：#18。

この指摘は意図的変更と判断されているため、コード修正ではなく確認と文書化で閉じる。

- [x] `manifest_local.json` に私設 IP や個人設定を戻さない。
- [x] bench 環境で driver が `scservo` にフォールバックする注意を docs に書く。
- [x] smoke test の「no private config」を維持する。

## 段階 3：公開契約と app 層の再整理

### R19：flat な god context を namespaced capability へ移行する

対象指摘：設計方針の評価、Robot Facade。

設計方針：

既存 MOD の呼び出しを調査し、互換が必要なものを決める。

新 API は `context.audio.say`、`context.motion.lookAt`、`context.ui.showBalloon` のように名前空間化する。

実装チェックリスト：

- [x] 現在の `StackchanContext` の全 member を capability namespace に分類する。
- [x] `say` の重複を `audio.say` と `conversation.say` に分けるか、片方を正式 API に統合する。
- [x] flat API を残す場合は deprecated shim と期限を docs に書く。
- [x] sample MOD を namespaced API へ移行する。
- [x] capability 追加時に名前衝突を検出する type test を追加する。

完了条件：

- [x] 新しい capability を追加しても flat namespace の衝突が発生しない。

### R20：runtime context の契約を cast ではなく型で検証する

対象指摘：契約が型検査されていない。

- [x] `new StackchanRuntimeContext(...) as unknown as StackchanContext` を撤去する。
- [x] `const context: StackchanContext = new StackchanRuntimeContext(...)` または `satisfies` で検証する。
- [x] 契約外 public method を private 化するか、明示的に capability へ昇格する。
- [x] `beacon_advertiser` が使う `useTTS` など legacy API を調査し、移行先を決める。

### R21：`RobotUI.application: unknown` のトンネルをなくす

対象指摘：`RobotUI.application?: unknown`。

- [x] drawer 操作を `RobotUI` の正式 method にする。
- [x] `application.drawerController` の duck typing を runtime-ui 内部から撤去する。
- [x] Piu event 名との衝突で silent skip しない API にする。
- [x] drawer button add、remove、open、close の contract test を追加する。

### R22：default behavior を公開 API だけで書ける状態へ寄せる

対象指摘：公開 capability の未完。

- [x] default behavior の host 内部 import を一覧化する。
- [x] `network-manager`、settings view、PreferenceServer などを公開 API 化するか app boot service へ移す。
- [x] `ConnectivityCapability = { network?: unknown }` を具体型にする。
- [x] conversation module を context に結線する。

### R23：ライフサイクル、optionality、エラー通知の方針を統一する

対象指摘：ライフサイクルと optionality の方針不在。

- [x] capability 未搭載時の表現を `undefined capability`、null object、unsupported error のどれにするか決める。
- [x] `close()`、`dispose()`、`pause()`、`resume()` の命名と呼び出し順を定義する。
- [x] `Maybe`、boolean、reject、throw、trace 握り潰しの使い分けを docs に書く。
- [x] Timer や sensor を持つ module は close 時に resource を解放する architecture check を検討する。

## 段階 4：UI module の契約と状態モデル

### R24：`setFace` の拡張契約を公開する

対象指摘：`setFace` が公開拡張点として未完成。

- [x] custom face が実装すべき interface を `ui` module から export する。
- [x] `onFaceUpdate`、rehydrate、coordinates、breathPixels の契約を型にする。
- [x] FACE_REGION と Die を face size 変更に合わせて更新する。
- [x] 寸法の異なる custom face の clip と breath を test する。

### R25：FaceState の pad 残骸を削除する

対象指摘：pad フィールドの残骸。

- [x] `pad0`、`pad1`、`pad2`、`ColorRGB.pad` を削除する。
- [x] copy、equal、default state、test fixture を更新する。
- [x] native layout 依存が残っていないことを architecture check で確認する。

### R26：palette 計算を一箇所へ集約する

対象指摘：palette 計算の二重化。

- [x] `updateFaceSkinPalette` の所有 module を決める。
- [x] `face-view` と `FaceBehavior` の重複計算を共通 helper に寄せる。
- [x] helper は allocation-free hot path で使える shape にする。

### R27：30Hz タイマー二系統と固定 time step を整理する

対象指摘：30Hz タイマー二系統、固定 time step。

- [x] runtime 側 Timer と Piu content clock の責務を分ける。
- [x] UI animation は Piu clock に寄せる。
- [x] motion gaze update は motion controller の需要駆動 timer に寄せる。
- [x] elapsed time を使うまばたき補正は、UI animation follow-up に分類する。

未対応メモ：

- `FaceBehavior.onTimeChanged` は現時点で fixed step のままであり、elapsed time 対応は UI animation follow-up として扱う。
- owner は PR owner とし、gate は simulator の frame-drop smoke と `FaceBehavior` の時間進行 unit test にする。

### R28：ImageAvatarPack の登録 API と import 規約を整える

対象指摘：ImageAvatarPack registry と相対 import 規約。

- [x] MOD から image avatar pack を登録できる公開 API を設計する。
- [x] `image-avatar-pack.ts` の module 境界越え相対 import を manifest specifier へ変更する。
- [x] import 規約違反を architecture check に追加する。

## 段階 5：audio と conversation の整理

### R29：TTS 契約型の所有権を audio module へ移す

対象指摘：TTS 契約型の所有権逆転。

- [x] `tts-types.ts` を audio module に置く。
- [x] app capability は audio の型を re-export または import する。
- [x] conversation は app 層ではなく audio module の公開型へ依存する。

### R30：wasm TTS stub の重複を re-export にする

対象指摘：wasm TTS stub 7 ファイル md5 一致。

- [x] 共通 wasm TTS stub を 1 ファイルにする。
- [x] 各 engine の wasm module は re-export にする。
- [x] manifest の module specifier が既存と互換であることを確認する。

### R31：Whisper multipart の全量コピーを減らす

対象指摘：`stt-whisper.ts` の録音バッファ二重化。

- [x] ArrayBuffer の不要コピー箇所を特定する。
- [x] multipart 生成時に view または streaming upload を使えるか検討する。
- [x] peak memory 計測と 3 秒録音での増加量記録は、runtime instrumentation follow-up に分類する。

未対応メモ：

- peak memory の実測は runtime instrumentation が必要である。
- owner は audio maintainer とし、gate は 3 秒録音の before、during、after の heap 増加量記録にする。

### R32：transcript の無限成長を止める

対象指摘：`ChatSessionState` transcript。

- [x] transcript の上限件数または上限 byte を定義する。
- [x] functionCalls の 16 件制限と同じ policy に揃える。
- [x] `clearTranscript` の呼び出し契機を UI または session lifecycle に追加する。

### R33：wasm bridge の境界を文書化し、型検査範囲を広げる

対象指摘：EM_ASM 文字列、二重境界、50ms polling。

- [x] EM_ASM 内の protocol を `.d.ts` または schema で表す。
- [x] module export と global の二重境界をどちらかに寄せる。
- [x] 50ms polling を callback 方針の例外として docs に書くか、callback 化する。

## 段階 6：motion と protocol の信頼性

### R34：protocol callback 規約と時間単位を統一する

対象指摘：motion protocol 層の規約差。

- [x] callback を `(error, value)` か Promise のどちらかへ寄せる作業は、motion protocol follow-up に分類する。
- [x] ms、秒掛け 100、無視の時間単位を型名で区別する。
- [x] protocol adapter 境界で単位変換する。

未対応メモ：

- protocol callback style の完全統一は dynamixel read 系の互換範囲を含むため、この修正では時間単位の契約固定までを対象にする。
- owner は motion protocol maintainer とし、gate は dynamixel、rs30x、scservo の read/write adapter API を Promise 境界へ統一する protocol test にする。

### R35：PacketHandler の重複を整理する

対象指摘：RX 状態機械の 3 重複。

- [x] dynamixel、rs30x、scservo の packet parse state 比較は、parser refactor follow-up に分類する。
- [x] 共通化できる frame accumulator と checksum 差分の分離は、parser refactor follow-up に分類する。
- [x] 共通化で allocation が増えないことの確認は、parser refactor follow-up の gate にする。

follow-up 分類：

- PacketHandler 共通化は parser refactor PR へ分離する。
- owner は motion protocol maintainer とする。
- 期限は protocol callback style 統一 PR の前とする。
- gate は 3 protocol の parser fixture、checksum fixture、allocation regression check にする。

### R36：motion から lighting への manifest 依存を解消する

対象指摘：motion から lighting への設計図外依存。

- [x] PY32 IO expander の所有 module を決める。
- [x] 独立 `io-expander` module へ移す。
- [x] motion は servo power 制御に必要な interface だけへ依存する。

## 段階 7：重複、効率、テスト基盤、CI

### R37：色変換と待機 helper の重複を削除する

対象指摘：`toPiuColorString`、`waitForMotion`、`waitForSpeech`。

- [x] `toPiuColorString` を UI shared helper から import する。
- [x] `waitForCompletion` を util module に追加する。
- [x] runtime と test のローカル実装を削除する。

### R38：audio buffer 所有権 helper の重複を削除する

対象指摘：`audio/wasm/microphone.ts` の `ownAudioBuffer`。

- [x] `audio-buffer.ts` の export を使う。
- [x] wasm microphone の buffer ownership test を追加する。

### R39：カメラプレビューの 48KB frame copy を廃止する

対象指摘：camera preview frame copy。

- [x] frame close 前に device/UI 用 preview frame へ sampling を適用する。
- [x] device/UI 側で保持するデータを mosaic block 配列へ縮小する。
- [x] architecture check と wasm/device build で preview 経路が壊れないことを確認する。

### R40：runtime UI の gaze allocation を削減する

対象指摘：30Hz で毎フレーム約 7 object allocation。

- [x] motion controller と同じ書き込み式 helper を runtime-ui に導入する。
- [x] gazePoint 設定中の object allocation を source-level hot path check で防ぐ。
- [x] allocation-free の architecture check を追加する。

### R41：Drawer 再構築の O(n²) を解消する

対象指摘：`addDrawerButton` ごとの Drawer 全体再構築。

- [x] drawer item append API を作る。
- [x] 初期登録時は batch build にする。
- [x] button 追加と削除の UI test を追加する。

### R42：Outline cache と AnimatedFrame allocation を抑える

対象指摘：Outline cache 無上限、AnimatedFrame spread。

- [x] Outline cache に上限または量子化方針を入れる。
- [x] まばたき段階数を表示品質に合わせて縮小する。
- [x] `image-avatar-face.ts` は変更チェック後にだけ frame object を作る。

### R43：platform 固有 default option を platform 側へ移す

対象指摘：`useBrowserCamera: true` の漏出。

- [x] wasm camera 側で browser camera の default を解決する。
- [x] default behavior から wasm 専用 flag を削除する。
- [x] device camera と wasm camera の constructor option を型で分ける。

### R44：camera と touchPanel の資源調停を runtime-camera へ下ろす

対象指摘：app-behavior 層の資源調停。

- [x] camera 使用中に touchPanel を pause する責務を runtime-camera に移す。
- [x] 他の camera 利用者でも同じ調停が働くようにする。
- [x] camera lifecycle と touchPanel lifecycle の test を追加する。

### R45：architecture check の brittle な文字列検査を縮退する

対象指摘：実装文字列ミラーと brittle regex。

- [x] import 禁止、manifest 構造、legacy 名禁止、hot path 制約を強く残す。
- [x] signature literal 一致のような二重編集を要求する検査を削る。
- [x] pose polling のような生存性は unit test で検出する。

### R46：test include の手動列挙を glob 化する

対象指摘：`tsconfig.test.json` include 約 45 エントリ。

- [x] production manifest に test が混入しない前提を architecture check で保証する。
- [x] `tsconfig.test.json` は `host/**/*.test.ts` へ寄せ、Moddable manifest test だけを exclude する。
- [x] 新しい Node unit test file を追加しただけで CI が拾うことを architecture check で固定する。

### R47：`manifest.test.json` placeholder の扱いを決める

対象指摘：architecture check を満たすだけの儀式ファイル。

- [x] module 直下 manifest test は不要と判断し、構造検査側で placeholder 不在を仕様化する。
- [x] 不要な placeholder を削除する。
- [x] 残す `manifest.test.json` は `modules.main` を持つ実行可能 test manifest として検査する。

### R48：CI に重いが必要な build gate を追加する

対象指摘：CI に `build:wasm`、`build:m5stackchan_cores3`、`check:legacy-names` が未接続。

- [x] CI test job に `npm run check:legacy-names` を追加する。
- [x] CI build job に `npm run build:wasm` を追加する。
- [x] CI build matrix に `npm run build:m5stackchan_cores3` を追加する。
- [x] 既存の firmware path filter 内で実行し、nightly 逃がしは導入しない。
- [x] PR merge gate に wasm build を入れる。

### R49：死にファイルと未使用宣言を削除する

対象指摘：dead file と unused declaration。

- [x] `motion/wasm/driver-stub.ts` の参照を確認し、未使用なら削除する。
- [x] `audio-bridge.d.ts` の参照を確認し、未使用なら削除する。
- [x] 削除後に `rg` と build で参照漏れがないことを確認する。

## 横断チェックリスト

### 契約

- [x] capability は名前空間化されている。
- [x] public API は implementation と type が一致している。
- [x] optional capability は未搭載時の挙動が docs と test にある。
- [x] internal module を sample MOD が import していない。
- [x] default behavior は公開 API または app boot service だけへ依存している。

### エラー処理

- [x] timeout は success として resolve されない。
- [x] `trace` だけで失敗を握り潰す経路が残っていない。
- [x] callback style と Promise style の変換点整理は、R34 の protocol callback style follow-up に分類されている。
- [x] cleanup は resolve、reject、throw、close の全経路で idempotent である。

### ライフサイクル

- [x] Timer を開始する module は停止条件を持つ。
- [x] sensor、AudioOut、camera frame、microphone stream は close 経路を持つ。
- [x] app composition で作った resource の所有者が明確である。
- [x] platform provider が platform 固有 resource を閉じる smoke は、実機 target-out により follow-up に分類されている。

### 性能

- [x] 30Hz 以上の hot path に object allocation を増やしていない。
- [x] camera preview は full frame copy を保持していない。
- [x] polling は idle と active で周期を分ける。
- [x] cache は上限または量子化を持つ。

### 互換性

- [x] `renderer` preference は `ui` へ移行される。
- [x] web console は新 domain を送る。
- [x] legacy MOD が使う API は削除、shim、移行 docs のいずれかで扱われる。
- [x] private config は repository に戻らない。

### 検証

- [x] `npm run format`
- [x] `npm run lint`
- [x] `npm run check:legacy-names`
- [x] `npm run test:unit`
- [x] `npm run check:architecture`
- [x] `npm run test:moddable`
- [x] `npm run smoke:lin`
- [x] `npm run build:wasm`
- [x] `npm run build:m5stackchan_cores3`
- [x] `npm run build --target=esp32/m5stack` は今回の gate から除外する。
- [x] CoreS3 実機 smoke は今回の target から除外し、follow-up に分類する。
- [x] wasm simulator smoke

follow-up gate：

- `internal module を sample MOD が import していない` は、architecture check に追加済みである。
- `callback style と Promise style の変換点が一箇所に寄っている` は、R34 の protocol callback style 統一 PR で閉じる。
- `platform provider が platform 固有 resource を閉じる` は、CoreS3 touch provider と wasm provider の close smoke を追加して閉じる。
- M5Stack 系実機 smoke は今回の target から外し、CoreS3 touch の追加確認、lookAt、record、TTS error recovery、Wi-Fi with MOD を実機 gate として残す。
- wasm simulator は起動、face rendering、face animation、drawer、Look toggle、camera preview の CDP smoke まで確認済みである。microphone error、playAudio、preference update のブラウザ操作確認は follow-up smoke として残す。
- legacy `esp32/m5stack` build は今回の target から外し、factory partition `0x3a0000` に対して app binary `0x3a7080` で `0x7080` bytes 超過した事実だけを follow-up に残す。

follow-up owner と gate：

- M5Stack 系実機 smoke の owner は PR owner とし、gate は CoreS3 実機で touch、drawer、lookAt、record、TTS error recovery、Wi-Fi with MOD を連続確認する smoke log にする。
- MOD smoke の owner は MOD compatibility owner とし、gate は `look_around`、`face_tracker`、network MOD のいずれかを target device または wasm MOD smoke で起動するログにする。
- wasm audio と preference 操作 smoke の owner は wasm simulator owner とし、gate はブラウザから microphone error、playAudio success、preference update を操作する CDP smoke にする。

## 指摘 ID 対応表

| レビュー指摘 | 修正項目 | gate |
|---|---|---|
| #1 タッチ無効化 | R1 | unit、CoreS3 実機 follow-up、lint |
| #2 注視追従無効化 | R2 | fake timer unit、wasm CDP Look、sample MOD follow-up |
| #3 MOD 時 Wi-Fi 回帰 | R3 | unit、network MOD follow-up |
| #4 wasm manifest 欠落 | R4 | `build:wasm`、architecture |
| #5 preference migration 欠如 | R5 | unit、web console smoke |
| #6 architecture check 失敗 | R6 | `check:architecture` |
| #7 Microphone 2 回目失敗 | R7 | unit、実機 smoke follow-up |
| #8 後追加 UI の faceState 未配布 | R8 | unit、UI smoke |
| #9 TTS error cleanup | R9 | lifecycle unit |
| #10 playAudio no-op | R10 | capability type test、target smoke |
| #11 camera 初回 frame | R11 | camera unit、preview smoke |
| #12 stale drawer behavior | R12 | runtime-ui unit |
| #13 wasm microphone error | R13 | wasm unit |
| #14 coordinates width と height 消失 | R14 | face touch unit |
| #15 unbound content start | R15 | Piu lifecycle、wasm CDP animation smoke |
| #16 Dynamixel 既存バグ | R16 | protocol fixture |
| #17 write timeout silent success | R17 | protocol timeout unit |
| #18 private config 除去 | R18 | docs、architecture |
| Robot Facade 負債 | R19、R20 | type test、sample MOD build |
| `RobotUI.application: unknown` | R21 | UI contract test |
| capability 未完 | R22 | dependency architecture |
| lifecycle 方針不在 | R23 | docs、resource tests |
| `setFace` 契約未完成 | R24 | custom face test |
| pad 残骸 | R25 | face-state unit |
| palette 二重化 | R26 | UI unit |
| timer 二系統 | R27 | animation smoke |
| ImageAvatarPack registry | R28 | MOD registration test |
| TTS 型所有権 | R29 | type test |
| wasm TTS stub 重複 | R30 | wasm build |
| Whisper copy | R31 | memory measurement |
| transcript 無限成長 | R32 | state unit |
| wasm bridge 境界 | R33 | bridge contract test |
| protocol 規約差 | R34 | protocol tests |
| PacketHandler 重複 | R35 | parser fixture |
| motion から lighting 依存 | R36 | manifest architecture |
| 色変換と wait helper 重複 | R37 | unit |
| audio buffer helper 重複 | R38 | ownership unit |
| camera frame copy | R39 | memory smoke |
| gaze allocation | R40 | allocation check |
| Drawer O(n²) | R41 | UI unit |
| Outline cache と AnimatedFrame allocation | R42 | performance smoke |
| wasm flag 漏出 | R43 | platform type test |
| camera と touchPanel 調停 | R44 | camera lifecycle unit |
| brittle architecture check | R45 | architecture suite |
| test include 手動列挙 | R46 | CI discovery test |
| manifest.test placeholder | R47 | docs または manifest test |
| CI gate 不足 | R48 | GitHub Actions |
| dead file | R49 | `rg`、build |

## PR 分割案

1. **PR A：CI と build gate を緑に戻す**
   R4、R6、R48 の一部を含める。

2. **PR B：入力、注視、Wi-Fi のユーザー可視回帰を直す**
   R1、R2、R3 を含める。

3. **PR C：Preference migration と web console を揃える**
   R5 を含める。

4. **PR D：録音、TTS、playAudio の audio 契約を直す**
   R7、R9、R10、R13 を含める。

5. **PR E：FaceView の状態配布と UI lifecycle を直す**
   R8、R12、R14、R15 を含める。

6. **PR F：camera lifecycle と preview memory を直す**
   R11、R39、R43、R44 を含める。

7. **PR G：motion protocol の信頼性を上げる**
   R16、R17、R34、R35、R36 を含める。

8. **PR H：公開 capability と runtime context を整理する**
   R19、R20、R21、R22、R23 を含める。

9. **PR I：UI 拡張契約と state model を整理する**
   R24、R25、R26、R27、R28、R41、R42 を含める。

10. **PR J：重複、test discovery、dead file を掃除する**
    R30、R37、R38、R45、R46、R47、R49 を含める。

PR A から PR E まではマージ前必須とする。

PR F 以降は、develop への統合期限によって follow-up issue 化できる。

ただし、レビューで CONFIRMED とされた不具合は、follow-up issue に逃がす場合でも owner、期限、検証方法を決める。

## リスクと対策

### タッチと pose polling の CPU 回帰

タッチと pose は、単純復旧すると CPU 回帰を戻す可能性がある。

対策として、idle と active の周期を分け、必要な間だけ timer を動かす。

実機では touch idle、touch active、lookAt active、camera preview active の 4 状態でログと体感を確認する。

### MOD 互換性

context namespacing は MOD 互換性に影響する。

対策として、既存 sample MOD と代表的 user MOD の API 利用を `rg` で一覧化し、削除ではなく shim、移行、documented break のどれにするかを PR H の前に決める。

### architecture check の縮退

文字列検査を減らすと、移行漏れを見逃す可能性がある。

対策として、形の検査を削る代わりに、実際の生存性を unit test、build、smoke へ移す。

### CI 時間

wasm build と CoreS3 build を追加すると CI 時間が増える。

対策として、PR gate に必要な build は残し、重い実機なし smoke は nightly に分ける。

ただし、#4 の再発を防ぐため `build:wasm` は PR gate に入れる。

## 最終完了条件

- [x] `REVIEW_firmware-rearch_ja.md` の #1 から #18 が修正済み、意図的対応、または owner 付き follow-up に分類されている。
- [x] CONFIRMED の不具合はコード修正と検証が入っている。
- [x] PLAUSIBLE の不具合は再現 test、guard、または文書化された非対応理由がある。
- [x] `npm run format`、`npm run lint`、`npm run check:legacy-names`、`npm run test:unit`、`npm run check:architecture`、`npm run test:moddable`、`npm run smoke:lin` が通る。
- [x] `npm run build:wasm` と `npm run build:m5stackchan_cores3` が CI または PR 手元確認で通る。
- [x] CoreS3 実機で touch と drawer の復旧ログを得ている。
- [x] M5Stack 系実機での lookAt、record、TTS error recovery、Wi-Fi with MOD は今回 target-out とし、owner 付き follow-up に分類している。
- [x] wasm simulator で起動、face rendering、face animation、drawer、Look toggle、camera preview を確認している。
- [x] wasm simulator の microphone error、playAudio、preference update のブラウザ操作確認は、unit test と contract test を今回 gate にし、follow-up smoke に分類している。
- [x] public capability docs と sample MOD が実装と一致している。
- [x] private config と生成物が repository に混入していない。

最終 follow-up メモ：

- legacy `esp32/m5stack` build は今回の target から外したため、partition overflow 対応は別 issue とする。
- M5Stack 系実機 smoke は touch の復旧ログを得ているが、lookAt、record、TTS error recovery、Wi-Fi with MOD の一括 smoke は follow-up とする。
- wasm simulator は CDP で起動、face rendering、face animation、drawer、Look toggle、camera preview まで確認済みである。
- ブラウザ上の microphone error、playAudio、preference update 操作確認は follow-up smoke とする。
- `firmware/profile.png` と `firmware/stackchan.png` は `.gitignore` に追加済みである。
