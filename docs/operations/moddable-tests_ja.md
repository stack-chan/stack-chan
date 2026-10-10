# Moddable v10の回帰テスト

`firmware/` の既存 `test:moddable` を使います。debug buildをXvfb上のLinuxシミュレーターで実行し、SDKのxsdbからJSONイベントを受け取ります。xsdbの依存saxophoneは `npm ci` でfirmware側へ導入します。SDK checkoutやグローバル設定へ書き込みません。

```sh
cd firmware
npm ci
# 専用SDKのexportを使う。MODDABLEとPATHは同じSDKを指すこと。
npm run test:moddable
npm run test:moddable -- --sdk
```

必要なホストツールはLinux用SDK build tools、Node.js、xvfb-runです。並列実行にはdbus-run-sessionも必要です。共有マシンでは `STACKCHAN_MODULE_TEST_JOBS=1` にしてビルド側のmake並列数も制限してください。

通常のコマンドは既存の `manifest.test.json` を動的に探し、Piuを使うものは `lin/m5stack`、その他は `lin` で実行します。引数で既存manifestやディレクトリを絞れます。見つかったテストがゼロなら失敗します。CIの正当な空shardは、全体にテストが存在する場合だけ空のまま終了します。

`--sdk` はSDK自身のPiu Skinテストをtestmc、XS Mathテストをtest262で実行します。両者はpreloadによる組み込みオブジェクトの凍結が異なるため混用しません。SDKのフルtestmc manifestはLinux非対応のOTA Updateを含むので、共通testmc・Piu・checksum画面・公式texture fixtureだけのmanifestを `firmware/dist/tmp/testmc/` に生成します。この専用構成は毎回再生成して古いmodule mappingのxsbを再利用しません。

結果はxsdbの `test_summary` の実測値です。1件以上のPASS、FAILゼロ、停止理由なし、総件数の整合性を要求します。全SKIP・未接続・タイムアウト・abort・debuggerの異常終了はPASSにしません。既存テストも最終 `ok` マーカーを実行中のXSから観測する必要があります。 TypeScriptは型エラーでもJavaScriptを生成することがあるため、失敗したbuildの専用tmp/bin出力は破棄し、次のwarm buildが失敗出力を再利用しないようにします。 この修正以前の失敗生成物が残るローカル環境では、最初の再試験に `STACKCHAN_MODULE_TEST_CLEAN=1` を指定します。CIのmodule cache世代も更新し、古い失敗生成物を復元しません。

`STACKCHAN_MODULE_TEST_LOG_DIR` を指定すると、その配下の実行別フォルダーにJSONログとSDK reportを保存します。省略時は一時フォルダーです。CIは `dist/test-logs` を失敗時もartifactとして保存します。`STACKCHAN_MODULE_TEST_TIMEOUT_MS` と `STACKCHAN_MODULE_TEST_BUILD_TIMEOUT_MS` で実行/ビルド上限を設定できます。SIGINT/SIGTERM中断は非zeroで終了し、このrunner自身の子プロセスだけを終了します。

## 実機の扱い

CIの実行ログにはシミュレーター実行であることを明示します。各実行は `hardware: NOT RUN` を表示します。シミュレーターのPASSからGPIO、SD、音声、サーボ、物理タッチ、RAM上限の実機PASSを推定しません。

既にdebug firmwareと検証MODが入った専用実機を使う場合は、実機担当者がポートを確認したうえで既存のread-onlyシリアル監視を使えます。

```sh
cd firmware
UPLOAD_PORT=/dev/ttyACM0 npm run test:device -- --channel serial
```

この経路はシリアル設定と読み取りのみです。`--flash` を付けません。debugの `trace()` はraw serialには流れないため、そのMODはxsbug経路で確認します。raw serialへ完了を出すMODだけがこの監視で成功できます。標準の完了マーカーは `M5StackChan CoreS3 smoke] complete` です。他の検証MODでは `STACKCHAN_DEVICE_SMOKE_OK` にそのMOD固有の完了マーカーを指定します。無言・通常hostのログだけ・クラッシュ・切断・タイムアウトは失敗です。

xsdbによるSDK testmc/test262の実機テストには、対応したdebug test appがあらかじめ必要です。SDKの正式手順に従って専用機で接続し、`test modules/piu/Skin` / `test xs/built-ins/Math` と `info tests` の結果を保存してください。test appの導入にはfirmware書き込みが伴うため、通常のCIやこのシミュレーターコマンドに自動flashを含めません。実機未確保なら `NOT RUN（実機未確保）` を記録します。

リリースの物理操作項目は [実機チェックリスト](release-device-test_ja.md) を併用し、候補SHA・ボード・SDK・実行した項目・ログを対応付けてください。

## 変更の影響

Issue #729 / #706。release impact: none。テストと開発手順のみで、配布firmware/Webの機能変更やrelease noteはありません。自前xsbug通信を通常module testから外し、SDK xsdbを正式な実行経路にしました。実機smokeのxsbug channelも同じxsdbを使い、自前のTCP/XML debugger実装を削除しました。既存の `test:device` はMOD書き込みを含むので、接続確認を除き専用検証機で別途実行してください。
