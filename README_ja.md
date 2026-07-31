# ｽﾀｯｸﾁｬﾝ(Stack-chan)

[![ファームウェアのビルド](https://github.com/stack-chan/stack-chan/actions/workflows/build.yml/badge.svg)](https://github.com/stack-chan/stack-chan/actions/workflows/build.yml)
[![Discordサーバへの招待](https://img.shields.io/badge/Discord-Join%20server-5865F2?logo=discord&logoColor=white)](https://discord.gg/eGhd9adnBm)

[English](./README.md)

![stackchan](./docs/images/stackchan.gif)

ｽﾀｯｸﾁｬﾝはM5Stackで作られた、JavaScriptで動くオープンソースのｽｰﾊﾟｰｶﾜｲｲﾛﾎﾞｯﾄです。

このリポジトリは、M5StackChan CoreS3を標準構成とするファームウェア、ユーザーアプリケーション（MOD）、ブラウザー上の開発ツール、ケース、回路図を提供します。

- 動画: https://youtu.be/fZb_mF08xV0
- 公式ハッシュタグ: [`#stackchan` | `#ｽﾀｯｸﾁｬﾝ` (JP)](https://twitter.com/search?q=%23stackchan%20OR%20%23%EF%BD%BD%EF%BE%80%EF%BD%AF%EF%BD%B8%EF%BE%81%EF%BD%AC%EF%BE%9D)

## 始め方

初めてｽﾀｯｸﾁｬﾝを使う場合は、組み立て済みのM5StackChanとWebツールを使う方法が最短です。

### 1. M5StackChanを用意する

M5StackChan AIデスクトップロボット（K151）単体で始められます。
ジョイスティックコントローラーは任意です。

- 国内: [M5StackChan本体](https://ssci.to/11129)
- 国内: [M5StackChan本体とジョイスティックコントローラー](https://ssci.to/11131)
- 海外: [M5Stack公式ストア](https://shop.m5stack.com/products/stackchan-kawaii-co-created-open-source-ai-desktop-robot)

### 2. ファームウェアを書き込む

M5StackChanをデータ通信対応のUSBケーブルでPCへ接続し、ChromeまたはEdgeで[Webファームウェア書き込み](https://stack-chan.github.io/stack-chan/web/flash/)を開きます。
機種には「M5StackChan CoreS3」を選択してください。
Moddable SDKやESP-IDFのセットアップは不要です。

> [!IMPORTANT]
> このリポジトリのファームウェアを書き込むと、M5Stackの工場出荷ファームウェアは置き換えられます。
> 元へ戻す場合は、[M5Stack公式ドキュメント](https://docs.m5stack.com/ja/StackChan)の復元手順に従ってM5Burnerを使用してください。

### 3. MODを試す

[MOD Gallery](https://stack-chan.github.io/stack-chan/web/mod-gallery/)では、公開されているMODやミニアプリを検索し、シミュレーターで試すか実機へ書き込めます。
ブロックで作られたサンプルは、そのままブロックエディタで開いて変更できます。

## Webツール

[ｽﾀｯｸﾁｬﾝ Webツール](https://stack-chan.github.io/stack-chan/web/)は、セットアップ、設定、MOD制作をブラウザーから行うための入口です。

| ツール | 用途 |
| --- | --- |
| [ファームウェア書き込み](https://stack-chan.github.io/stack-chan/web/flash/) | 対応するM5StackへUSB経由でファームウェアを書き込む |
| [設定](https://stack-chan.github.io/stack-chan/web/preference/) | BLE経由でWi-Fiや本体設定を変更する |
| [MOD Gallery](https://stack-chan.github.io/stack-chan/web/mod-gallery/) | 公開済みのMODを試し、編集し、実機へ書き込む |
| [ブロックエディタ](https://stack-chan.github.io/stack-chan/web/editor/) | BlocklyでMODを作り、シミュレーターや実機で動かす |
| [Shape顔エディタ](https://stack-chan.github.io/stack-chan/web/face-editor/) | 目と口を配置してカスタムFaceを作る |
| [シミュレーター](https://stack-chan.github.io/stack-chan/web/simulator/) | WebAssembly版ファームウェアと3DモデルでMODを試す |
| [MediaPipe BLE追従](https://stack-chan.github.io/stack-chan/web/mediapipe/) | カメラで捉えた顔と手の動きをBLEで送る |

## 対応ハードウェア

配布ファームウェアは、M5Stack、M5Stack Core2、M5Stack CoreS3、M5StackChan CoreS3に対応します。
標準構成と実機リリース検証の対象はM5StackChan CoreS3です。

Stack-chan RTとタカオ版Core2 + SG90向けのファームウェアは、ソースからビルドできます。
機種ごとのコマンドと制約は[ファームウェアの説明](./firmware/README_ja.md)を参照してください。

自作する場合は、[ケース](./case/README_ja.md)と[回路図](./schematics/README_ja.md)から必要な部品と組み立て方を確認できます。

## リポジトリの構成

- [firmware](./firmware/): ホストファームウェア、モジュール、MOD、開発スクリプト
- [web](./web/): ファームウェア書き込み、設定、エディタ、Gallery、シミュレーター
- [case](./case/): 3Dプリント用のケースデータ
- [schematics](./schematics/): 回路図と基板レイアウト
- [docs](./docs/): ロードマップ、仕様、運用文書、リリースノート

## 開発

- [ファームウェア開発](./firmware/README_ja.md)
- [MOD開発](./firmware/mods/README_ja.md)
- [ファームウェアAPI](./firmware/docs/api_ja.md)
- [コントリビューションガイド](./CONTRIBUTING.md)
- [最新リリース](https://github.com/stack-chan/stack-chan/releases/latest)
- [開発ロードマップ](./docs/ROADMAP_ja.md)

## コントリビューション

機能追加の提案、バグ報告、Pull Requestを歓迎します。
[コントリビューションガイド](./CONTRIBUTING.md)を確認するか、[Issue](https://github.com/stack-chan/stack-chan/issues)を作成してください。

開発を資金面で支援する場合は、[GitHub Sponsors](https://github.com/sponsors/meganetaaan/)を利用できます。

## ライセンス

このリポジトリ配下のリソースはApache version 2.0ライセンスのもと配布されています。
[LICENSE](./LICENSE)を確認してください。

## BibTeX

```bibtex
@misc{stackchan,
  author       = {Shinya Ishikawa and the Stack-chan community},
  title        = {Stack-chan: A JavaScript-driven Super-kawaii Robot},
  year         = {2021},
  howpublished = {\url{https://github.com/stack-chan/stack-chan}},
  note         = {Open-source hardware and software.},
}
```
