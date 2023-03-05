# プログラムのビルドと書き込み

[English](./flashing-firmware.md)

## ｽﾀｯｸﾁｬﾝのプログラム構成について

### ホストと MOD

![ｽﾀｯｸﾁｬﾝのプログラム構成](./images/host-and-mod.jpg)

ｽﾀｯｸﾁｬﾝのファームウェアは、ｽﾀｯｸﾁｬﾝの基本動作を提供するプログラム（ホスト）とユーザアプリケーション（MOD）から構成されます。
一度ホストを書き込んでしまえば、ユーザアプリケーションのインストールは短時間で終わるため高速な開発が可能です。
最初にホストを書き込み、必要に応じて MOD の書き込みを行います。

### マニフェストファイル

ホストと MOD はそれぞれ、設定用のマニフェストファイル（manifest.json）、JavaScript モジュールのソースコード、画像や音声などのリソースから構成されます。
マニフェストファイルでは、JavaScript モジュールの名前と場所（modules）や、モジュール内から参照できる設定（config）などを含みます。
また、マニフェストファイルは他のマニフェストファイルを含める（include）こともできます。

全ての設定項目は[Moddable の公式ドキュメント（英語）](https://github.com/Moddable-OpenSource/moddable/blob/public/documentation/tools/manifest.md)を参照してください。

## 設定変更

ｽﾀﾝｸﾁｬﾝが使うモータの種類やピンアサインなどをマニフェストファイルから変更できます。
ユーザが変更する設定は[`stackchan/manifest_local.json`](../stackchan/manifest_local.json)にまとまっています。
`"config"`キーの配下に次のような設定が書けます。

| キー              | 説明                                            | 使用可能な値                                |
| ----------------- | ----------------------------------------------- | ------------------------------------------- |
| driver.type       | モータドライバの種類                            | "scservo", "rs30x", "pwm", "none"           |
| driver.panId      | パン軸（首の横回転）に使うシリアルサーボの ID   | 1~254                                       |
| driver.tiltId     | チルト軸（首の横回転）に使うシリアルサーボの ID | 1~254                                       |
| driver.offsetPan  | チルト軸のオフセット                            | -90~90                                      |
| driver.offsetTilt | チルト軸のオフセット                            | -90~90                                      |
| tts.type          | [TTS](./text-to-speech_ja.md) の種類                                      | "local", "voicevox"                         |
| tts.host          | TTS がサーバと通信する場合のホスト名            | "localhost", "ttsserver.local" などの文字列 |
| tts.port          | TTS がサーバと通信する場合のポート番号          | 1~65535                                     |

### 設定例: ｽﾀｯｸﾁｬﾝ M5Bottom版キットを動かす

紅木タカオ氏（[@mongonta0716](https://github.com/mongonta0716)）が頒布する
[ｽﾀｯｸﾁｬﾝ組み立てキット M5Bottom版](https://mongonta.booth.pm/)を本リポジトリのファームウェアで動かすための設定例です。
M5Bottom版は本リポジトリと違って専用基板を使わず、M5Bottomのポートとサーボを接続します。

M5Stack Core2のPort.Cを使う場合:

```json
{
    "config": {
        "driver": {
            "type": "pwm",
            "pwmPan": 13,
            "pwmTilt": 14
        }
    }
}
```

M5Stack BasicのPort.Cを使う場合:

```json
{
    "config": {
        "driver": {
            "type": "pwm",
            "pwmPan": 16,
            "pwmTilt": 17
        }
    }
}
```

参考: [ｽﾀｯｸﾁｬﾝ M5GoBottom版のファームウェアについて \| M5Stack沼人の日記](https://raspberrypi.mongonta.com/softwares-for-stackchan/)

## ホストの書き込み

次のコマンドでホストの書き込みを行います。


```console
# M5Stack Basic/Gray/Fireの場合
$ npm run build
$ npm run deploy

# M5Stack CORE2の場合
$ npm run build --target=esp32/m5stack_core2
$ npm run deploy --target=esp32/m5stack_core2
```

ビルドしたプログラムは`$MODDABLE/build/`ディレクトリ配下に保存されます。

## MODの書き込み

次のコマンドでMODの書き込みを行います。

```console
# M5Stack Basic/Gray/Fireの場合
$ npm run mod [modのマニフェストファイルのパス]

# M5Stack Core2の場合
$ npm run mod --target=esp32/m5stack_core2 [modのマニフェストファイルのパス]
```

__例: [`mods/look_around`](../mods/look_around/)をインストールする__

```console
$ npm run mod ./mods/look_around/manifest.json

> stack-chan@0.2.1 mod
> mcrun -d -m -p ${npm_config_target=esp32/m5stack} ${npm_argument} "./mods/look_around/manifest.json"

# xsc mod.xsb
# xsc check.xsb
# xsc mod/config.xsb
# xsl look_around.xsa
Installing mod...complete
```

## 次のステップ

- [mods/README_ja.md](../mods/README_ja.md): 同梱のサンプルMODの紹介です。
- [API](./api_ja.md): ｽﾀｯｸﾁｬﾝのAPIドキュメントです。
