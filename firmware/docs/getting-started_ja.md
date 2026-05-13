# 環境構築

[English](./getting-started.md)

## 開発に必要なもの

* ホストPC（Windows/Mac/Linuxのいずれか）
    * 以下の環境でテスト済み
        * Linux(Ubuntu24.04)
* M5Stack版StackChan CoreS3（標準構成）
    * Basic/Core2/CoreS3 も開発対象として利用できます。
* USB type-Cケーブル
* [git](https://git-scm.com/)
* [Node.js](https://nodejs.org/en/)
    * v22でテスト済み

## ｽﾀｯｸﾁｬﾝリポジトリのクローン

本リポジトリをクローンします。

```console
$ git clone https://github.com/stack-chan/stack-chan.git
$ cd stack-chan/firmware
$ npm i
```

## ModdableSDKのセットアップ

ホストPCで[ModdableSDK](https://github.com/Moddable-OpenSource/moddable)と
[ESP-IDF](https://docs.espressif.com/projects/esp-idf/en/latest/esp32/get-started/index.html)をインストールします。
次の3通りの方法があります。初めて触る場合は `xs-dev` を使う方法を選んでください。

- CLIを使う（推奨）
- Dockerイメージを使う
- 手動でセットアップする

### xs-devを使う（推奨）

ｽﾀｯｸﾁｬﾝはセットアップ手順をnpmスクリプト化しています。
`stack-chan/firmware`ディレクトリで次のコマンドを実行します。

```console
$ npm run setup
```

内部で[`xs-dev`](https://github.com/HipsterBrown/xs-dev)を使ってModdableSDKやESP-IDFのセットアップを自動化しています。
ESP32 向けに必要なセットアップは `npm run setup` に含まれます。

### Dockerイメージを使う（Linuxのみ）

このリポジトリはDockerfileによるビルド環境を提供しています。
Dockerコンテナの中でファームウェアのビルド、書き込みとデバッグが可能です。

注意：Linux（Ubuntu24.04）で動作確認しています。Windows（WSL）やMacOSでは、コンテナ側からのデバイスへの接続がうまくいかない[問題](https://github.com/stack-chan/stack-chan/issues/144)が報告されているため、非推奨です。

#### ターミナルから

`stack-chan/firmware`ディレクトリで次のコマンドを実行します。

```console
$ ./docker/build-container.sh
$ ./docker/launch-container.sh

# コンテナ内で以下を実行
$ npm install
```

#### VSCodeから

VSCodeのDevContainer用設定を同梱しています。
以下のコマンドでコンテナ内でプロジェクトを開けます。

* コマンドパレットを開く(ctrl+shift+p)
* `>Remote-Containers: Reopen in Container`を実行する

### 手動で行う

[公式サイトの手順（英語）](https://github.com/Moddable-OpenSource/moddable/blob/public/documentation/Moddable%20SDK%20-%20Getting%20Started.md)に従ってModdableSDKとESP-IDFをインストールします。
CLIやDockerがうまくセットアップできない場合はこちらを行ってください。

## (オプション)ModdableSDKのアップデート

本リポジトリの更新に伴う機能追加や不具合解消のため、ModdableSDKのアップデートが必要となる場合があります。

### xs-devを使う（推奨）

ｽﾀｯｸﾁｬﾝはアップデート手順もnpmスクリプト化しています。
`stack-chan/firmware`ディレクトリで次のコマンドを実行します。

```console
$ npm run update
```

### 手動で行う

[公式サイトの手順（英語）](https://github.com/Moddable-OpenSource/moddable/blob/public/documentation/Moddable%20SDK%20-%20Getting%20Started.md)に従ってModdableSDKとESP-IDFをアップデートします。

## 環境のテスト

`npm run doctor`コマンドで環境のテストができます。
インストールに成功していれば次のようにModdable SDKのバージョンが表示され、Supported target devicesにesp32が表示されます。

```console
$ npm run doctor

> stack-chan@0.2.1 doctor
> xs-dev doctor

xs-dev environment info:
  CLI Version                0.32.7                                                                 
  OS                         Linux                                                                  
  Arch                       x64                                                                    
  Shell                      /bin/bash                                                              
  NodeJS Version             v22.9.0 (/home/sskw/.nvm/versions/node/v22.9.0/bin/node)               
  Python Version             3.12.3 (/home/sskw/.espressif/python_env/idf5.3_py3.12_env/bin/python) 
  Moddable SDK Version       5.3.3 (/home/sskw/.local/share/moddable)                               
  Supported target devices   lin, esp32                                                             
  ESP32 IDF Directory        /home/sskw/.local/share/esp32/esp-idf 

If this is related to an error when using the CLI, please create an issue at "https://github.com/hipsterbrown/xs-dev/issues/new" with the above info.
```

## 次のステップ

- [プログラムのビルドと書き込み](./flashing-firmware_ja.md)
