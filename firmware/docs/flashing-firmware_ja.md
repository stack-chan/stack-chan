# プログラムのビルドと書き込み

[English](./flashing-firmware.md)

## ｽﾀｯｸﾁｬﾝのプログラム構成について

初めて書き込む場合は、標準構成の M5Stack版StackChan CoreS3 を前提にできます。
必要な情報は次の3つです。

- 使う本体: 標準は M5Stack版StackChan CoreS3
- 書き込むもの: まずはホスト、開発を繰り返す時だけ MOD
- Wi-Fi やサーボなどの設定: 必要になったら `stackchan/manifest_local.json` または専用 manifest に書く

### ホストと MOD

![ｽﾀｯｸﾁｬﾝのプログラム構成](./images/host-and-mod.jpg)

ｽﾀｯｸﾁｬﾝのファームウェアは、ｽﾀｯｸﾁｬﾝの基本動作を提供するプログラム（ホスト）とユーザアプリケーション（MOD）から構成されます。
一度ホストを書き込んでしまえば、ユーザアプリケーションのインストールは短時間で終わるため高速な開発が可能です。
最初にホストを書き込みます。
顔や動きの小さな追加を試す段階では、必要に応じて MOD だけを書き込みます。
ホストを書き直すより MOD の書き込みのほうが短時間で終わります。

### マニフェストファイル

ホストと MOD はそれぞれ、設定用のマニフェストファイル（manifest.json）、JavaScript モジュールのソースコード、画像や音声などのリソースから構成されます。
マニフェストファイルでは、JavaScript モジュールの名前と場所（modules）や、モジュール内から参照できる設定（config）などを含みます。
また、マニフェストファイルは他のマニフェストファイルを含める（include）こともできます。

全ての設定項目は[Moddable の公式ドキュメント（英語）](https://github.com/Moddable-OpenSource/moddable/blob/public/documentation/tools/manifest.md)を参照してください。

## 設定変更

ｽﾀｯｸﾁｬﾝが使うモータの種類やピンアサインなどをマニフェストファイルから変更できます。
ユーザが変更する設定は[`stack-chan/firmware/stackchan/manifest_local.json`](../stackchan/manifest_local.json)にまとまっています。
`"config"`キーの配下に次のような設定が書けます。

| キー              | 説明                                            | 使用可能な値                                |
| ----------------- | ----------------------------------------------- | ------------------------------------------- |
| driver.type       | モータドライバの種類                            | "scservo", "rs30x", "pwm", "none", "dynamixel"           |
| driver.panId      | パン軸（首の横回転）に使うシリアルサーボの ID   | 1~254                                       |
| driver.tiltId     | チルト軸（首の縦回転）に使うシリアルサーボの ID | 1~254                                       |
| driver.offsetPan  | パン軸のオフセット                              | -90~90                                      |
| driver.offsetTilt | チルト軸のオフセット                            | -90~90                                      |
| tts.type          | [TTS](./text-to-speech_ja.md) の種類            | "local", "voicevox", "remote", "voicevox-web", "elevenlabs", "openai"                         |
| tts.host          | TTS がサーバと通信する場合のホスト名            | "localhost", "ttsserver.local" などの文字列 |
| tts.port          | TTS がサーバと通信する場合のポート番号          | 1~65535                                     |
| tts.volume          | TTS を再生する時の音量          | 0~1                                     |

また、`"include"`キーの配下にリスト形式で他のマニフェストファイルのパスを指定できます。

### 設定例: ｽﾀｯｸﾁｬﾝ M5Bottom 版キットを動かす

紅木タカオ氏（[@mongonta0716](https://github.com/mongonta0716)）が頒布する
[ｽﾀｯｸﾁｬﾝ組み立てキット M5Bottom 版](https://mongonta.booth.pm/)を本リポジトリのファームウェアで動かすための設定例です。
M5Bottom 版は本リポジトリと違って専用基板を使わず、M5Bottom のポートとサーボを接続します。

M5Stack Core2 の Port.A（M5Stack Core2 本体側面の赤い穴）を使う場合:

`manifest_local.json`

```json
{
  // ...
  "config": {
    "driver": {
      "type": "pwm",
      "pwmPan": 33,
      "pwmTilt": 32
    }
  }
}
```

M5Stack Core2 の Port.C を使う場合:

`manifest_local.json`

```json
{
  // ...
  "config": {
    "driver": {
      "type": "pwm",
      "pwmPan": 13,
      "pwmTilt": 14
    }
  }
}
```

M5Stack Basic の Port.C を使う場合:

`manifest_local.json`

```json
{
  // ...
  "config": {
    "driver": {
      "type": "pwm",
      "pwmPan": 16,
      "pwmTilt": 17
    }
  }
}
```

ファームウェア導入後、ｽﾀｯｸﾁｬﾝが左右に首振りを行うようであれば成功です。

参考: [ｽﾀｯｸﾁｬﾝ M5GoBottom 版のファームウェアについて \| M5Stack 沼人の日記](https://raspberrypi.mongonta.com/softwares-for-stackchan/)

## よく使うコマンド

`stack-chan/firmware` ディレクトリで実行します。

| やりたいこと | コマンド |
| --- | --- |
| 環境を確認する | `npm run doctor` |
| 標準構成をビルドする | `npm run build` |
| 標準構成を書き込む | `npm run flash` |
| ターミナルにログを出して起動する | `npm run debug` |
| MOD を書き込む | `npm run mod -- mods/look_around/manifest.json` |

標準構成は M5Stack版StackChan CoreS3 です。
別の M5Stack 本体に書き込む場合は、引数ではなく名前付きコマンドを使います。

| 本体 | ビルド | 書き込み | デバッグ |
| --- | --- | --- | --- |
| M5Stack Basic/Gray/Fire | `npm run build:basic` | `npm run flash:basic` | `npm run debug:basic` |
| M5Stack Core2 | `npm run build:core2` | `npm run flash:core2` | `npm run debug:core2` |
| M5Stack CoreS3 | `npm run build:cores3` | `npm run flash:cores3` | `npm run debug:cores3` |
| M5Stack版StackChan CoreS3 | `npm run build:m5stackchan` | `npm run flash:m5stackchan` | `npm run debug:m5stackchan` |

## 基本プログラム（ホスト）の書き込み

前述の通りｽﾀｯｸﾁｬﾝのファームウェアは基本プログラム（ホスト）とユーザアプリケーション（MOD）から構成されます。
次のコマンドで基本プログラム（ホスト）のビルドと書き込みを行います。

_コマンドに`sudo`をつける必要はありません。_

```console
$ npm run flash
```

ビルドだけ確認したい場合は `npm run build` を使います。
ビルドしたプログラムは`$MODDABLE/build/`ディレクトリ配下に保存されます。

正しく書き込めていれば起動から数秒後にｽﾀｯｸﾁｬﾝの顔が表示されます。
M5Stack のボタンを押すと次のように変わります。

- A ボタン（CoreS3 の場合は画面左下の領域） ... ｽﾀｯｸﾁｬﾝが 5 秒おきにランダムな方向を見る
- B ボタン（CoreS3 の場合は画面中央下の領域） ... ｽﾀｯｸﾁｬﾝが左、右、下、上を向く
- C ボタン（CoreS3 の場合は画面右下の領域） ... ｽﾀｯｸﾁｬﾝの顔の色が反転する

## デバッグ

次のコマンドで、プログラムを起動してターミナルにデバッグ出力を表示できます。

```console
$ npm run debug
```

このコマンドは選択した Stack-chan platform に対して `xs-dev run --log` を使います。ターミナルだけで作業したい場合や、ログをコピーして共有したい場合に便利です。
ブレークポイントやステップ実行を使いたい場合は Moddable のデバッガ `xsbug` を使います。詳しい使い方は[公式ドキュメント（英語）](https://github.com/Moddable-OpenSource/moddable/blob/public/documentation/xs/xsbug.md)を参照してください。

## （オプション）ユーザアプリケーション（MOD）の書き込み

次のコマンドでユーザアプリケーション（MOD）の書き込みを行います。

_コマンドに`sudo`をつける必要はありません。_

```console
$ npm run mod -- [modのマニフェストファイルのパス]
```

package.json 形式で作った MOD ディレクトリを指定した場合は、Moddable SDK 同梱の `mcpack mcrun` を使って書き込みます。
既存サンプルのような manifest.json 形式の MOD は、従来通り `mcrun` で書き込みます。

**例: [`mods/look_around`](../mods/look_around/)をインストールする**

```console
$ npm run mod -- ./mods/look_around/manifest.json

> stack-chan@0.2.1 mod
> node scripts/firmware.mjs mod ./mods/look_around/manifest.json

# xsc mod.xsb
# xsc check.xsb
# xsc mod/config.xsb
# xsl look_around.xsa
Installing mod...complete
```

## (オプショナル)フラッシュ領域の消去

MODを描き込み後、MODを書き込みする前の挙動に戻したい時は、次のコマンドで書き込んだMODを消去することができます。

> [!NOTE]  
> コマンドを実行するとMODの領域だけでなく、フラッシュ領域全体を消去します。  
> Preferenceを使って設定値を書き込んでいる場合、その設定も消去されることに注意してください。  
> また、コマンド実行後は再度ホストの書き込みが必要になります。  

```console
$ npm run erase-flash

> stack-chan@0.2.1 erase-flash
> esptool.py erase_flash

esptool.py v4.8.dev4
Found 2 serial ports
Serial port /dev/cu.usbserial-01F05597
Connecting....
Detecting chip type... Unsupported detection protocol, switching and trying again...
Connecting.........
Detecting chip type... ESP32
Chip is ESP32-D0WDQ6-V3 (revision v3.0)
Features: WiFi, BT, Dual Core, 240MHz, VRef calibration in efuse, Coding Scheme None
Crystal is 40MHz
MAC: 8c:aa:b5:81:6c:1c
Uploading stub...
Running stub...
Stub running...
Erasing flash (this may take a while)...
Chip erase completed successfully in 25.4s
Hard resetting via RTS pin...
```

## 次のステップ

- [mods/README_ja.md](../mods/README_ja.md): 同梱のサンプル MOD の紹介です。
- [API](./api_ja.md): ｽﾀｯｸﾁｬﾝの API ドキュメントです。
