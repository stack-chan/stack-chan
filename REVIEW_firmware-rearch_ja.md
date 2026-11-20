# firmware 再設計（refactor/rearch）レビュー — develop 差分

- **対象**: `develop`（merge-base `276f4791`）から現在の作業ツリーまでの全差分（未コミット変更を含む）。563 ファイル、+14,498 / -10,556 行。
- **方法**: バグ検出 8 角度（正確性 3 + 再利用 / 簡素化 / 効率 / 抽象度 / 規約）＋設計レビュー 4 領域（app 層 / UI / audio・conversation / motion・ビルド基盤）のマルチエージェント調査 → 候補ごとの検証（コード読解・`check:architecture` / `test:unit` / biome の実行・merge-base との突合）。
- **判定**: CONFIRMED = コード・実行で確認済み / PLAUSIBLE = 現実的な条件で発生し得るが実機依存。

---

## 総評

再設計の骨格（app＝起動と合成 / modules / platforms の分離、manifest によるプラットフォーム差分、callback 契約、数値 state、co-located テスト、architecture check の CI 接続）は移行計画（`docs/architecture/firmware-rearchitecture_ja.md`）にほぼ忠実に実装されており、方向性は良い。依存方向（modules → app への import なし）も守られている。ユニットテストは作業ツリーで 84/84 合格。

一方で、**マージ前に決着が必要な問題が明確に存在する**：

1. 「CPU regression investigation」の一時無効化 2 件（タッチ入力全滅・注視追従全滅）が作業ツリーに残っている
2. MOD インストール時に Wi-Fi 接続経路が消える回帰
3. wasm ビルドを壊す manifest 欠落
4. `npm run check:architecture` が現在失敗（CI 赤）
5. preference ドメイン改名の移行パス欠如（既存デバイス・web コンソールが壊れる）

また、設計面では「Robot Facade の解消が名目的（フラットな god-context のまま）」「公開 capability API の不足を default behavior 自身が内部 import で回避している」「`RobotUI.application: unknown` の duck-typing トンネル」が中期的な負債として残る。

---

## 重大な問題（マージブロッカー候補・重要度順）

### 1. タッチ入力が全プラットフォームで無効化されたまま [CONFIRMED]

`firmware/host/app/compose.ts:188-194` — `const touch = undefined` / `const touchPanel = undefined` がハードコードされ、`Touch`/`TouchPanel` の import はコメントアウト（「CPU regression investigation: temporarily disable touch polling」）。

- 影響: CoreS3 の撫でられジェスチャ（`on-context-created.ts:529-592` の petting 処理、約 60 行）が完全にデッドコード化。カメラプレビューの touchPanel pause/resume（commit c8c812f で追加）も守る対象が存在しない。MOD が読む `context.touch`/`touchPanel` は無警告で undefined。
- 付随: `compose.ts:11` の `import config from 'mc/config'` が未使用になり biome が警告（実行確認済み）。`lint:fix` がこの import を自動削除すると、コメントアウトの復旧がさらに壊れる。
- 推奨: 原因（ポーリングコスト）は input モジュール側で解消（interval 調整・条件付きポーリング・設定オプトイン）し、compose の配線は復旧してから merge。少なくとも issue 化と followups 文書への記載が必要。

### 2. サーボポーズポーリング無効化で lookAt（注視追従）が全ドライバで死んでいる [CONFIRMED]

`firmware/host/modules/motion/motion-controller.ts:122-124` — `Timer.repeat(this.updatePose, INTERVAL_POSE)` がコメントアウト。grep の結果、本番コードで `updatePose` を定期呼び出しする箇所は他にない。

- 影響: `robot.lookAt()` は `#gazePoint` を保存するだけで、サーボは動かず `pose.body.rotation` も更新されない。drawer の「Look」トグル、`look_around` / `face_tracker` 等のサンプル MOD、`runtime-ui.ts` の相対視線計算（常に стале な 0,0,0 を参照）が影響を受ける。
- テストは `updatePose()` を手動呼び出しするため退行を検出できない。fake timer による「Timer 経由で追従する」テストの追加を推奨。
- 推奨: #1 と同じく、CPU 回帰の恒久対策（gazePoint 設定時のみポーリング等）を決めてから merge。

### 3. MOD をインストールすると Wi-Fi に接続しなくなる回帰 [CONFIRMED]

`firmware/host/app/app-behavior-resolver.ts:10-13` — MOD 存在時は `[mod]` のみを返し default behavior を完全置換。Wi-Fi 接続（`connectStoredWiFi`）は `default-behavior/on-launch.ts` にのみ存在する。

- merge-base では `main.ts:269` が `await checkAndConnectWiFi()` を MOD フックの**前に無条件実行**し、フックは `mod.onLaunch ?? default.onLaunch` の per-hook フォールバックだった。
- example MOD で `onLaunch` を定義しているのは `dynamixel` のみ。`chatgpt` / `ai_stackchan` / `cheerup_ws` / MCP 系などネットワーク必須 MOD は、有効な Wi-Fi 設定があっても接続なしで起動し全滅する。
- 「完全置換」は followups §5 の設計判断だが、その帰結として基盤機能（Wi-Fi・設定画面・PreferenceServer）が MOD から再現不能になっている。Wi-Fi 接続は host 側起動シーケンスか公開 capability へ移すべき。
- 関連 [PLAUSIBLE]: default 経路でも `connectStoredWiFi()` は fire-and-forget になり（`on-launch.ts:66`）、起動直後の発話/フェッチが Wi-Fi/SNTP ハンドシェイクと競合する。旧コードの「WiFi connection failed」trace も消え、接続失敗が無表示。

### 4. wasm ビルドが壊れている: manifest に `app-behavior-resolver` が無い [CONFIRMED]

`firmware/host/platforms/wasm/manifest.json:21-41` — modules 列挙に `../../app/app-behavior-resolver` が無いが、`host/app/main.ts:5` は `./app-behavior-resolver` を import している（`host/app/manifest.json:29` には存在）。commit 6f0837e で resolver を追加した際の wasm 側未追従。

- 影響: `npm run build:wasm`（web シミュレータ）がモジュール解決で失敗する。CI に build:wasm が無いため検出されない。
- 推奨: wasm manifest への追加＋app モジュール列挙の二重管理解消（共通 include 化 or architecture check への追加）＋CI への build:wasm 追加。

### 5. preference ドメイン `renderer`→`ui` 改名に移行パスが無い [CONFIRMED]

`firmware/host/modules/preferences/consts.ts` — DOMAIN から `renderer` が消え `ui` になったが、フォールバック読み出しも移行処理もない。

- 影響: 旧ファームで flash に保存された `renderer.type='dog'` 等は無視され、顔が silent に `simple` へ戻る。さらに **`web/preference/index.html` は今も `renderer.type` を送信しており**（67, 148-149 行目）、web コンソールからの顔設定が新ファームに効かない。
- 推奨: 初回起動時の `renderer`→`ui` 移行（または両ドメイン読み）と、web 側の追従修正。

### 6. `npm run check:architecture` が失敗しており CI が赤になる [CONFIRMED]

実行確認: subtest「provides a M5StackChan CoreS3 smoke MOD with no private config」が fail（`platform-manifest.architecture.ts:66` の正規表現 `/esp32:\.\/host\/platforms\/m5stackchan_cores3/` が、書き換え後の `firmware/docs/m5stackchan-cores3-smoke.md` にマッチしない）。

- `.github/workflows/build.yml:51` がこのチェックを実行するため、このまま push すると CI が落ちる。移行計画の「[x] 対応済み：check:architecture を実行する」というチェックと実態が矛盾。
- 推奨: 検査の期待値を新しいビルドコマンド表記（`npm run build:m5stackchan_cores3`）に合わせて更新。

### 7. `Microphone.record()` が 2 回目以降常に失敗する [CONFIRMED]

`firmware/host/modules/audio/microphone.ts:40` — `this.recording = true` を設定するが、resolve する両経路（chunk 枯渇時・満杯時）で false に戻さない。

- 影響: drawer の「Record and playback」を 2 回押すと `Error('already recording')`。録音は 1 起動 1 回のみ。
- 修正: resolve 直前に `this.recording = false`（reject/close 経路含む）。

### 8. 後から追加したバルーン／エフェクトに顔テーマが適用されない [CONFIRMED]

`firmware/host/modules/ui/views/main/face-view.ts:82-87` — `faceStatesEqual` による早期 return が `onFaceState` の配布ごとスキップするため、状態が静止している間に追加されたコンテンツは初回の `onFaceState` を受け取れない。

- `addEffect` は再配布（rehydrate）をしない（`setFace` は `applyFaceState` で再送しており非対称）。`SpeechBalloon` は `onDisplaying` でデフォルト状態（白地/黒字）を適用するため、`setColor` でテーマ設定後に `showBalloon('moving...')` 等（発話なし＝mouth 変化なし）を呼ぶと、**次に顔状態が変わるまでデフォルト配色で表示される**。emoticon も同機構だが通常は emotion 変更と同時なので次 tick で自己修復する。
- 修正: `addEffect`/`showBalloon` 時に現在の faceState/palette を新規コンテンツへ配布する（`setFace` と同じ rehydrate パターン）。

### 9. TTS エラー時に口が開いたままになる／エンジンが固まり得る [CONFIRMED / PLAUSIBLE]

全 6 デバイス TTS エンジン共通（例: `firmware/host/modules/audio/tts-local.ts:60-67`）:

- [CONFIRMED] `onError` 経路は `callback(e)` を呼ぶが `onDone` を呼ばないため、`runtime-audio.ts` の口閉じ処理（`onMouthOpenChanged(0)`）がエラー時に走らず、発話途中エラーで口が開いたまま残る。
- [PLAUSIBLE] `this.streaming = true` の直後に streamer コンストラクタが同期 throw すると（不正ホスト等）、フラグが立ったままになり以後常に「already playing」。
- 修正: AudioOut ライフサイクル＋クリーンアップを共通ヘルパへ抽出し（6 エンジンで約 200 行の重複削減）、throw 時のフラグリセットとエラー時の onDone 呼び出しを一箇所で担保。

### 10. `playAudio` がデバイスで常に no-op [CONFIRMED]

`firmware/host/app/runtime-audio.ts:99-104` — `Tone` を optional な `play` 持ちへキャストするだけで、デバイス版 `tone.ts` に `play()` は存在しない（wasm 版のみ実装）。capability（`capabilities.ts:71`）は全ターゲットに `playAudio(): Promise<boolean>` を公開しており、契約が実態を偽っている。現状リポジトリ内に呼び出し元はないが、MOD 作者は無警告で false を受け取る。

---

## その他の確認済み問題（優先度中〜低）

| # | 場所 | 内容 | 判定 |
|---|------|------|------|
| 11 | `camera/device/camera.ts:99` | `start()` 直後の `capture()` は初回フレーム未到達で undefined を返しやすい（イベントループを挟まず `read()` 直叩き、リトライなし）→ プレビューが「camera unavailable」になり得る | PLAUSIBLE |
| 12 | `runtime-ui.ts:150-207` | `#drawerBehavior` が `useUI()` 後も旧 application の behavior を指したまま。`removeDrawerButton` が旧オブジェクトから削除する | CONFIRMED |
| 13 | `audio/wasm/microphone.ts:58-68` | 録音エラー時（status<0）に空 ArrayBuffer を黙って resolve。bridge が書く `state.error` を読む口が無い | CONFIRMED |
| 14 | `face-view.ts:255-258` | `face.coordinates = {left, top}` は全置換で width/height を落とす。タッチ判定領域が縮む可能性 | PLAUSIBLE |
| 15 | `behaviors/face.ts:80-82` | `onCreate` での `container.start?.()` は未バインド content に対して無効（`onDisplaying` が正） | PLAUSIBLE |
| 16 | `motion/protocols/dynamixel.ts:618, 490, 703` | `values[0] & 0x8000`（1 byte に常に偽）、`setOffsetAngle` の逆変換式の符号消失、4 byte 要求 2 byte 使用 — **いずれも merge-base から移設された既存バグ**（この branch 起因ではない） | CONFIRMED（既存） |
| 17 | `motion/protocols/*` | write コマンドのタイムアウトが undefined resolve で**無エラー成功扱い**（rs30x 40ms〜dynamixel 200ms）。trace のみで上位へ伝搬しない | CONFIRMED |
| 18 | `manifest_local.json` | config が空 `{}` に（旧: driver none / voicevox / 私設 IP）。私設情報の除去として**意図的と判断**（smoke テストも "no private config" を検査）— ベンチ環境では driver が scservo にフォールバックする点だけ留意 | 意図的 |

---

## 設計方針の評価

### 全体アーキテクチャ（app 層）

**計画との整合は概ね良好**。`main.ts` は起動順序のみ、`compose.ts` が生成と注入、MOD 置換は純粋関数 resolver 化され Node テストと一致。modules → app への逆 import は無い。

主要な divergence:

- **「Robot Facade の解消」は名目的**。`StackchanRuntimeContext` は内部を 6 runtime に委譲したが外形は 30 超メンバの god-object のままで、`StackchanContext` は 9 capability のフラットな intersection（`capabilities.ts:118-126`）。`say` の重複（audio と conversation で同一シグネチャ）が示す通り、capability 追加で名前衝突が必然化する。`context.audio.say` / `context.motion?` の名前空間化を推奨。
- **契約が型検査されていない**。`new StackchanRuntimeContext({...}) as unknown as StackchanContext`（`compose.ts:240-252`）の二重 cast により、runtime が契約を満たすかのコンパイル時検証が無い。`satisfies` / 構造的代入への置換を推奨。また `useTTS`/`useDriver`/`seed` 等は契約外なのに runtime の public 表面に残り、実際に `beacon_advertiser` MOD が `robot.useTTS` を使用中。
- **`RobotUI.application?: unknown` がトンネル化**。drawer 操作は `application.drawerController` の duck typing＋`app.behavior` への動的 key 書き込み（Piu イベント名と衝突すると silent skip/hijack）。`RobotUI` 契約に drawer メソッドを正式に載せるべき。
- **公開 capability の未完**: `ConnectivityCapability = { network?: unknown }` はプレースホルダ、conversation モジュールは context に未結線（設計図の `PublicAPI → Conversation` 未実現）。default behavior 自身が内部モジュール（network-manager、settings-view 等）を直接 import しており、「default behavior は公開 API で書ける」状態に達していない。
- **ライフサイクル／optionality の方針不在**: コンストラクタ副作用（`Timer.repeat`、`touchPanel.start()`）に対する stop/dispose 規約が無く、capability 未搭載時の表現が 5 通り（null object / throw / `?.` no-op / 黙殺 / undefined 公開）に分岐。エラー通知も Maybe / reject / boolean / throw / trace 握り潰しが混在。統一ポリシーの策定を推奨。

### UI モジュール

**状態モデル・dirty tracking・hot path 規律は良い**。plain object 化した FaceState を境界ごとにコピーして所有権分離、周期更新でのアロケーション禁止は architecture check で担保、Outline/Skin のキャッシュ、Die クリップ＋整数 px 差分の呼吸など、Piu の慣用に忠実。`face-state-view.h`（cdv バイナリレイアウト）の削除は、ネイティブ消費者が既に不在のため**正しい単純化**（XS では plain slot アクセスの方が速い）。

課題:

- **`setFace` が公開拡張点として未完成**: カスタム face の契約（`onFaceUpdate`/`rehydrate`/`breathPixels` 等）が face-view.ts 内部の構造的型でしか存在せず、FACE_REGION（Die）が初期 face のサイズで固定されるため寸法の異なる face に差し替えるとクリップ/呼吸欠けが起きる。契約型の公開と Die リサイズが必要。
- **pad フィールドの残骸**: `pad0/pad1/pad2`・`ColorRGB.pad`（`face-state.ts:37, 68-70`）は C 構造体パディングの名残で、6 関数にわたり無意味な同期を強いる。削除推奨。
- palette 計算の二重化（face-view と FaceBehavior が独立に `updateFaceSkinPalette`）、30Hz タイマー二系統（runtime 側 Timer と Piu content clock）、固定タイムステップ（フレーム落ちでまばたきが間延び）。
- ImageAvatarPack のレジストリが静的で MOD から登録不能。`image-avatar-pack.ts:1` の相対 import はモジュール指定子規約（followups §3）違反。

### audio / conversation モジュール

**方針適合度は高い**（callback 契約、manifest によるプラットフォーム差分、数値 state、DI によるテスト容易性）。課題は上記 #7・#9・#10 のバグ群に加え:

- TTS 契約型が audio モジュールでなく app 層 `capabilities.ts` にあり所有権が逆転。`tts-types.ts` へ移して re-export すべき。
- デバイス 6 エンジンの AudioOut ライフサイクル重複（約 200 行）と、wasm TTS スタブ 7 ファイルが**バイト単位で同一**（md5 確認済み）。motion モジュールは同問題を re-export 1 行で解決済みであり、同じパターンへ揃えるだけでよい。
- `stt-whisper.ts:40-46` の multipart 全量コピー（録音バッファがピーク時 2 重、3 秒録音で約 200KB）。
- `ChatSessionState` の transcript が無限成長（`clearTranscript` を誰も呼ばない）。functionCalls の 16 件制限と対称に上限を。
- wasm ブリッジ: ロジックが C 内の EM_ASM 文字列（lint/型検査対象外）、モジュール export とグローバルの二重境界、50ms ポーリングが callback 統一方針の未文書例外。

### motion / 周辺モジュール / ビルド・テスト基盤

- **ドライバ抽象（`MotionDriver` 契約＋allocation-free `getRotation`）は良好**。ただし protocol 層で callback 規約（Maybe vs (value, error)）と時間単位（ms / 秒×100 / 無視）が 3 protocol でバラバラ、PacketHandler（RX 状態機械）が 3 重複、write タイムアウトが silent success（#17）。
- **motion→lighting の manifest 依存は設計図に無い逸脱**（PY32 IO expander 目的）。util か独立モジュールへ。
- **テスト 3 層戦略（unit / moddable / architecture check）は明快で CI 接続済み**。旧 `firmware/tests` の消失カバレッジは確認されず（全て移設済み）。ただし:
  - `tsconfig.test.json` の include が約 45 エントリの手動列挙で、**テストを追加しても黙って実行されない**事故が構造的に起こる。glob 化推奨。
  - モジュール直下の `manifest.test.json` は `modules.main` を持たない placeholder で、architecture check を満たすためだけの儀式ファイル。
  - `.architecture.ts` は移行不変条件の機械化として価値がある一方、正規表現によるソース文字列検査は brittle で、「形は検査するが生存性は検査しない」（pose polling を無効化しても全チェック通過、が象徴的）。シグネチャ literal 一致などの過剰固定は縮退を推奨。
  - CI に `build:wasm`・`build:m5stackchan_cores3`・`check:legacy-names` が未接続（#4 の見逃しの直接原因）。

---

## クリーンアップ推奨（重複・効率）

**重複（すべて事実確認済み）**:

- `toPiuColorString` の再実装が 4 箇所（`multirow-balloon.ts:47`〈同ファイルで本家も import 済み〉、`mouth.ts:17`、`emoticon.ts:135`、`camera-preview-view.ts:18` の `piuColor`）。
- `waitForMotion`（`runtime-context.ts:23`）と `waitForSpeech`（`runtime-audio.ts:18`）が行単位で同一＋テストに 3 個目。`stackchan-util` へ `waitForCompletion` として抽出。
- `audio/wasm/microphone.ts:5` の `ownAudioBuffer` ローカル再定義（`audio-buffer.ts` が export 済み）。
- カメラプレビュー描画（mosaic ループ）が ui view と camera/wasm で 2 重。
- `compose.ts:118-136` の `(param) => new X(param as ConstructorParameters<typeof X>[0])` ×11 はジェネリックなファクトリヘルパ 1 行に集約可能。
- 死にファイル: `motion/wasm/driver-stub.ts`（どこからも参照なし）、未使用 `audio-bridge.d.ts`。

**効率（ESP32/XS の RAM・GC 前提)**:

- `on-context-created.ts:236` — カメラプレビューが 48KB フレームを `slice(0)` で複製し 5 秒間保持（実際に描くのは約 15 ブロックのモザイク）。フレーム close 前に `sampleRgb565LeMosaic` を適用すれば約 600 byte で済む。
- `runtime-ui.ts:113-127` — 30Hz の顔更新で gazePoint 設定中は毎フレーム約 7 オブジェクト割り当て。default behavior の targetLoop により実質常時発生。motion-controller が同じ計算を書き込み式ヘルパで allocation-free 化済みなので揃えられる。
- `common-view.ts:86-90` — `addDrawerButton` のたびに Drawer 全体を再構築。既定で 10 ボタン登録するため起動時に O(n²)。
- `eye.ts:73` ほか — Outline キャッシュが無上限（〜400 エントリ/パーツ種）。まばたき 24 段階の量子化は過剰。
- `image-avatar-face.ts:100` — 変更チェック前に spread で AnimatedFrame を生成（まばたき/発話中 ~90 alloc/秒）。

**抽象度（設計の深さ）**:

- `useBrowserCamera: true` を共有 default-behavior が無条件で渡している（wasm 専用フラグの漏出）。wasm カメラ側でデフォルト解決すべき。
- カメラ⇔タッチパネルの資源調停が app-behavior 層に実装されている（他のカメラ利用者が同じ罠を踏む）。runtime-camera へ下ろす。
- `app-capabilities.architecture.ts` / `face-state.architecture.ts` の実装文字列ミラーは、リファクタごとに二重編集を要求する。高価値な検査（依存方向・manifest 構造）だけ残して縮退を。

---

## 検証記録

- `npm run test:unit`: **84/84 合格**（face-state 書き換え後の作業ツリー）
- `npm run check:architecture`: **失敗**（54 中 1 fail — smoke doc 正規表現、#6）
- `npx biome lint host/app/compose.ts`: noUnusedImports 警告 1 件（#1 付随）
- wasm TTS スタブ 7 ファイル: md5 全一致（`3c1db3d5…`）
- merge-base 突合: 旧 `stackchan/main.ts` の Wi-Fi await（#3）、旧 preference ドメイン `renderer`（#5）、Dynamixel バグの既存性（#16）を `git show 276f4791:` で確認

## 検出上限に関する注記

ファインダーは docs / assets / package-lock / 生成画像テーブルを除く実質コード全域を走査したが、examples 配下の各 MOD 本体（約 23 個）の内部ロジック、`schematics`・`case`、web アプリ本体は深掘りしていない。BLE (`stk-server.js`) と HTTP server は untyped JS のまま移設されており、今回のレビュー深度は浅い。
