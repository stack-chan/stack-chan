# 環境構築

## 開発に必要なもの

* ホストPC
    * Linux(Ubuntu20.04)でテスト済み
* M5Stack Basic
* USB type-Cケーブル
* [git](https://git-scm.com/)
* [Node.js](https://nodejs.org/en/)
    * v16.14.2でテスト済み

## ｽﾀｯｸﾁｬﾝリポジトリのクローン

`--recursive`オプションをつけて本リポジトリをクローンします。

```console
$ git clone --recursive https://github.com/meganetaaan/stack-chan.git
$ cd stack-chan/firmware
$ npm i
```

## ModdableSDKのセットアップ

ホストPCで[ModdableSDK](https://github.com/Moddable-OpenSource/moddable)と
[ESP-IDF](https://docs.espressif.com/projects/esp-idf/en/latest/esp32/get-started/index.html)をインストールします。
次の3通りの方法があります。

- CLIを使う（推奨）
- Dockerイメージを使う
- 手動でセットアップする

### xs-devを使う（推奨）

ｽﾀｯｸﾁｬﾝはセットアップ手順をnpmスクリプト化しています。
`stack-chan/firmware`ディレクトリで次のコマンドを実行します。

```console
$ npm run setup
$ npm run setup -- --device=esp32
```

内部で[`xs-dev`](https://github.com/HipsterBrown/xs-dev)を使ってModdableSDKやESP-IDFのセットアップを自動化しています。

### Dockerイメージを使う

このリポジトリはDockerfileによるビルド環境を提供しています。
Dockerコンテナの中でファームウェアのビルド、書き込みとデバッグが可能です。

注意：Linux（Ubuntu20.04）で動作確認しています。Windows（WSL）やMacOSでは正しく動作しない可能性があります。

#### ターミナルから

```console
$ ./build-container.sh
$ ./launch-container.sh

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

## 環境のテスト

`npm run doctor`コマンドで環境のテストができます。
インストールに成功していれば次のようにModdable SDKのバージョンが表示され、Supported target devicesにesp32が表示されます。

```console
$ npm run doctor

> stack-chan@0.2.1 doctor
> xs-dev doctor

xs-dev environment info:
  CLI Version                0.20.0                                                                
  OS                         Linux                                                                 
  Arch                       x64                                                                   
  NodeJS Version             v16.14.2 (/usr/local/bin/node)                                        
  Python Version             3.8.10 (/home/sskw/.espressif/python_env/idf4.4_py3.8_env/bin/python) 
  Moddable SDK Version       3.6.0 (/home/sskw/.local/share/moddable)                              
  Supported target devices   lin, esp32                                                            
  ESP32 IDF Directory        /home/sskw/.local/share/esp32/esp-idf                                 

If this is related to an error when using the CLI, please create an issue at "https://github.com/hipsterbrown/xs-dev/issues/new" with the above info.
```

## 次のステップ

- 👉[プログラムのビルドと書き込み](./flashing-firmware_ja.md)
