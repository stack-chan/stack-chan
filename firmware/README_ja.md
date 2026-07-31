# ｽﾀｯｸﾁｬﾝ ファームウェア

[English](./README.md)

## このファームウェアについて

M5StackChanにプリインストールされているM5Stackの工場出荷ファームウェアと、このリポジトリが提供するｽﾀｯｸﾁｬﾝファームウェアは別のソフトウェアです。
安定した環境が必要な場合は[最新リリース](https://github.com/stack-chan/stack-chan/releases/latest)を使用してください。
既定ブランチの`develop`では、次回リリースに向けて内部構造やAPIが変わる場合があります。

「AIｽﾀｯｸﾁｬﾝ」は、@robo8080が中心となって開発している別のArduinoベースのアプリケーションです。
AIｽﾀｯｸﾁｬﾝを探している場合は[AI_StackChan2](https://github.com/robo8080/AI_StackChan2)を参照してください。

Arduino IDEになじみがあり、PWMサーボを使う場合は、@mongonta0716さんの[stack-chan-tester](https://github.com/mongonta0716/stack-chan-tester)も選択肢になります。

## ブラウザーで試す

ファームウェアを初めて試す場合は、[ｽﾀｯｸﾁｬﾝ Webツール](https://stack-chan.github.io/stack-chan/web/)を使うとローカル開発環境を用意せずに始められます。

1. M5StackChanをデータ通信対応のUSBケーブルでPCへ接続します。
2. ChromeまたはEdgeで[Webファームウェア書き込み](https://stack-chan.github.io/stack-chan/web/flash/)を開き、「M5StackChan CoreS3」を選択して書き込みます。
3. [MOD Gallery](https://stack-chan.github.io/stack-chan/web/mod-gallery/)でMODを選び、シミュレーターまたは実機で試します。

> [!IMPORTANT]
> このファームウェアを書き込むと、M5Stackの工場出荷ファームウェアは置き換えられます。
> 元へ戻す場合は、[M5Stack公式ドキュメント](https://docs.m5stack.com/ja/StackChan)の復元手順に従ってM5Burnerを使用してください。

## ローカル開発を始める

標準構成はM5StackChan CoreS3です。
ソースコードを変更する場合は、`firmware`ディレクトリで次の順に実行します。

```console
npm i
npm run setup
npm run setup -- --device=esp32
npm run doctor
npm run flash
```

`npm run flash`は標準構成のホストをビルドして書き込みます。
Stack-chan RTまたはタカオ版Core2 + SG90では、`npm run flash:stackchan_rt`または`npm run flash:takao_core2_sg90`を使います。
MODだけを更新する場合は、`npm run mod -- mods/examples/look_around/manifest.json`のようにMODの`manifest.json`を指定します。
このコマンドはMODアーカイブをビルドし、実機の`xs`パーティションを検出して`esptool`で直接書き込みます。
xsbugの書き込み経路を使わないため、ホストはデバッグビルドとリリースビルドのどちらでも構いません。

## 特徴

- JavaScriptまたはTypeScriptでMODを開発できます。
- ホストプログラムとMODが分離されているため、ホストを書き直さずにMODを短時間で更新できます。
- 顔、モーション、入力、音声、カメラ、通信を機能単位のcontext APIから利用できます。
- Feetech、FUTABA、DYNAMIXEL、PWMサーボを含む複数のモーター構成に対応します。
- Stack-chan Voice、VOICEVOX、ElevenLabs、OpenAIを使った音声合成に対応します。
- ファームウェア書き込み、BLE設定、MOD Gallery、ブロックエディタ、顔エディタ、WebAssemblyシミュレーターをブラウザーから利用できます。
- ファームウェアとWeb UIは日本語、英語、簡体字中国語に対応します。

## ビルド出力

ファームウェア開発にはリポジトリのnpmスクリプトを使ってください。
これらのコマンドはModdableの出力先を管理し、ホスト、MOD、テストの生成物を`firmware/dist/`配下に保存します。

- プログラムは`firmware/dist/bin/`、中間生成物は`firmware/dist/tmp/`配下に生成されます。
- ホストアプリケーション名は`stack-chan-host`です。
- `npm run clean`は`firmware/dist/`配下の生成物をすべて削除します。
- リポジトリのビルド手順では、独自の`-o`を指定したり、`mcconfig`、`mcrun`、`mcpack`を直接実行したりしないでください。
- `npm run bundle`は各リリース対象を`firmware/dist/`配下でビルドし、検証済みの成果物を`firmware/dist/bundle-targets/`に集約します。
  最終的なディレクトリとZIPは`firmware/host/app/`配下に生成されます。
- 対象ごとのリリースビルドには、名前付きの`build:release:<target>`スクリプトを使います。
  CIも同じスクリプトでビルドし、`bundle:package`で成果物を組み立てます。

ターゲット別のコマンドと詳しい出力先は、[プログラムのビルドと書き込み](docs/flashing-firmware_ja.md)を参照してください。

## ディレクトリ構成

- [host](./host/): ホストアプリケーションとファームウェアモジュールのソースコードです。
- [mods](./mods/): MODのソースコードです。
- [scripts](./scripts/): ビルド、検証、テスト、音声生成に用いる開発スクリプトです。
- [typings](./typings/): Moddable SDKの一部モジュールとｽﾀｯｸﾁｬﾝ固有APIを補うTypeScript型定義です。
- `dist/`: ファームウェアのプログラムと中間生成物です。
  ビルドスクリプトが管理し、Gitの追跡対象にはなりません。

## ドキュメント

### ブラウザーで使う

- [Webツール](https://stack-chan.github.io/stack-chan/web/)
- [Webブラウザーからのファームウェア書き込み](docs/flashing-firmware-web_ja.md)
- [Webブラウザーからの設定変更](docs/setting-preferences-web_ja.md)
- [MOD Gallery](https://stack-chan.github.io/stack-chan/web/mod-gallery/)

### ローカルで開発する

- [環境構築](docs/getting-started_ja.md)
- [プログラムのビルドと書き込み](docs/flashing-firmware_ja.md)
- [API](docs/api_ja.md)
- [MOD](mods/README_ja.md)
- [ローカライズ](docs/localization_ja.md)
- [ミニアプリ（実験的）](docs/mini-apps_ja.md)
- [v1.0.0リリースノート](../docs/release-notes/v1.0.0.md)
