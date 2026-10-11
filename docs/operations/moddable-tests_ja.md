# Stack-chan の Moddable モジュールテスト

`firmware/` で `npm run test:moddable` を実行します。Stack-chan の既存 `manifest.test.json` を探し、debug build を Linux mcsim で実行します。Piu を使うテストは `lin/m5stack`、その他は `lin` が対象です。SDK 自身の Skin／Math テストを実行するオプションはありません。

SDK の標準 xsbug-log が TCP/XML 通信を処理し、既存 runner がテキストログと完了マーカーを観測します。SDK checkout とグローバル設定は変更しません。SDK 依存の saxophone は firmware の `npm ci` で用意します。

```sh
cd firmware
npm ci
# 専用 SDK の環境を読み込み、MODDABLE と PATH を揃える
npm run test:moddable
```

必要なツールは Linux 用 SDK build tools、Node.js、xvfb-run です。並列実行には dbus-run-session も必要です。共有マシンでは `STACKCHAN_MODULE_TEST_JOBS=1` にし、make 側の並列数も制限してください。既存 manifest やディレクトリを引数に指定すると対象を絞れます。テストがゼロなら失敗します。全体にテストが存在する場合の空 shard は正常に終了します。

## 完了と失敗

各テストは必要な assertion と非同期処理を終えてから、独立した行として `trace('@@STACKCHAN_TEST:PASS@@\n')` を出します。既存の `ok` と同じ終了位置にあり、import 直後や Promise の完了前には出しません。共通 assertion の失敗と最終 Promise の rejection は `@@STACKCHAN_TEST:FAIL@@` を出します。捕捉して処理する例外の診断ログだけを FAIL にしません。

runner は完全なマーカー行を判定します。標準 xsbug-log の thread 表示と prompt、端末制御文字を扱い、UTF-8 の文字と行が複数の stdout chunk に分かれても保持します。診断の JSON や裸の `ok`、マーカーに言及する文章は完了になりません。FAIL と致命的停止を PASS より先に確認します。未接続、タイムアウト、debugger の stderr／異常終了、完了前の mcsim 終了も失敗です。完了を出さない例外は、致命的停止またはタイムアウトとして検出します。

起動した debugger と simulator は終了時・SIGINT/SIGTERM 中断時に片付けます。build と simulator のプロセスグループは SIGTERM で停止し、2秒後も終了しなければ SIGKILL に進み、終了を待ちます。終了待ちの間に届いた FAIL・致命的停止・debugger エラーも PASS より優先します。テストごとにポート、project、X display、DBus、XDG_CONFIG_HOME を分け、他の作業と設定を共有しません。

## ログと再試験

`STACKCHAN_MODULE_TEST_LOG_DIR` の下に実行別のログを保存します。省略時は一時フォルダーです。CI は失敗時も `dist/test-logs` を artifact に残します。実行と build の上限は `STACKCHAN_MODULE_TEST_TIMEOUT_MS` と `STACKCHAN_MODULE_TEST_BUILD_TIMEOUT_MS` で指定できます。

型エラーでも TypeScript が JavaScript を生成する場合があります。worker と並列実行前の warmup のどちらも、build が失敗した専用 tmp/bin 出力は破棄し、次回の warm build が失敗した生成物を使わないようにします。古い生成物が残る環境では、初回の再試験に `STACKCHAN_MODULE_TEST_CLEAN=1` を指定してください。

xsbug-log の待受を確認してから mcsim を起動します。テストごとの DBus と設定ディレクトリで simulator を分離します。SIGINT／SIGTERM 中断は非ゼロで終了し、この runner が起動した子プロセスだけを停止します。

## 実機との区別

このコマンドは `hardware: NOT RUN` と表示し、実機へ flash しません。シミュレーターで成功しても GPIO、SD、音声、サーボ、物理タッチ、RAM 上限の実機検証を通過したことにはなりません。

debug firmware と検証 MOD が入った専用実機の smoke は既存 `test:device` の xsbug channel で別途確認します。標準 smoke MOD の `trace()` は xsbug に届くため、raw serial reader は用意しません。`--channel serial` は理由を表示して直ちに失敗します。通常の host ログ、無言、クラッシュ、timeout は成功にしません。debugger の待受 timeout でも、起動した debugger を終了させます。

リリースの物理操作は [実機チェックリスト](release-device-test_ja.md) に従い、候補 SHA・ボード・SDK・実施項目・ログを残してください。Issue #729 / #706 に関連します。release impact は none で、配布 firmware／Web の機能変更はありません。
