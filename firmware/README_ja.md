# ｽﾀｯｸﾁｬﾝ ファームウェア

[English](./README.md)

## 注意

* __AIｽﾀｯｸﾁｬﾝの情報を見てここにたどり着いた方へ__ ここには求める情報がないかもしれません！「AIｽﾀｯｸﾁｬﾝ」は@robo8080が中心となって開発中のArduinoベースのアプリケーションです。
    * https://github.com/robo8080/AI_StackChan2
* ファームウェアは現在も積極的に開発中です。内部の作りやAPIが大きく変わる可能性があります。
* 「Moddableの環境構築の手順が多くて大変」という課題に対して、現在[issue](https://github.com/meganetaaan/stack-chan/issues/65)を立てて対応中です。環境構築でつまづいた方はフィードバックをぜひお寄せください。
* Arduino IDEになじみのある方は @mongonta0716 さんの[stack-chan-tester](https://github.com/mongonta0716/stack-chan-tester)もお試しください（PWMサーボのみ対応）。

## 特徴

* JavaScriptを使ったプログラミングが可能
* 複数のサーボモーター（Feetech、FUTABA、DYNAMIXEL、PWMサーボ）に対応
* クラウド音声合成（VOICEVOX、ElevenLabs）に対応
* ホストプログラムとユーザアプリケーション（MOD）が分離した設計。MODのみの書き換えは非常に高速なので、効率的に開発サイクルを回せます。
* [Webブラウザからのファームウェア書き込み](docs/flashing-firmware-web_ja.md)に対応

## ディレクトリ構成

- [stackchan](./stackchan/): ファームウェアのソースコードです。
- [mods](./mods/): MODのソースコードです。
- [scripts](./scripts/): ｽﾀｯｸﾁｬﾝの音声合成などに用いるスクリプトです。
- [extern](./extern/): 外部のモジュールです。
- [typings](./typings/): TypeScriptの型定義ファイル（d.ts）です。
    - ※ｽﾀｯｸﾁｬﾝのファームウェアは一部を除きTypeScriptで実装されているので別途型定義ファイルは必要ありませんが、Moddable SDKの新しめのモジュールは型定義ファイルが提供されていないため、それを補う用途で置いてあります。

## ドキュメント

- [環境構築](docs/getting-started_ja.md)
- [プログラムのビルドと書き込み](docs/flashing-firmware_ja.md)
- [API](docs/api_ja.md)
- [MOD](mods/README_ja.md)

- [Webブラウザからのファームウェア書き込み](docs/flashing-firmware-web_ja.md)
- [Webブラウザからの設定変更](docs/setting-preferences-web_ja.md)
