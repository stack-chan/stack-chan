# ｽﾀｯｸﾁｬﾝ ファームウェア

[English](./README.md)

## 注意

* ファームウェアは現在も積極的に開発中です。内部の作りやAPIが大きく変わる可能性があります。
* 「Moddableの環境構築の手順が多くて大変」という課題に対して、現在[issue](https://github.com/meganetaaan/stack-chan/issues/65)を立てて対応中です。環境構築でつまづいた方はフィードバックをぜひお寄せください。
* Arduino IDEになじみのある方は @mongonta0716 さんの[stack-chan-tester](https://github.com/mongonta0716/stack-chan-tester)もお試しください（PWMサーボのみ対応）。

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
