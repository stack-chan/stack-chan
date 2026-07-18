# プログラムのビルドと書き込み

[English](./flashing-firmware.md)

## ｽﾀｯｸﾁｬﾝのプログラム構成について

### ホストと MOD

![ｽﾀｯｸﾁｬﾝのプログラム構成](./images/host-and-mod.jpg)

ｽﾀｯｸﾁｬﾝのファームウェアは、ｽﾀｯｸﾁｬﾝの基本動作を提供するプログラム（ホスト）とユーザアプリケーション（MOD）から構成されます。
一度ホストを書き込んでしまえば、ユーザアプリケーションのインストールは短時間で終わるため高速な開発が可能です。
最初にホストを書き込み、必要に応じて MOD の書き込みを行います。
MOD がインストールされていない場合、ホストは製品既定動作を実行します。
MOD がインストールされている場合、製品既定動作は実行されず、MOD が `onContextCreated` で runtime context を受け取ります。

### マニフェストファイル

ホストと MOD はそれぞれ、設定用のマニフェストファイル（manifest.json）、JavaScript モジュールのソースコード、画像や音声などのリソースから構成されます。
マニフェストファイルでは、JavaScript モジュールの名前と場所（modules）や、モジュール内から参照できる設定（config）などを含みます。
また、マニフェストファイルは他のマニフェストファイルを含める（include）こともできます。

全ての設定項目は[Moddable の公式ドキュメント（英語）](https://github.com/Moddable-OpenSource/moddable/blob/public/documentation/tools/manifest.md)を参照してください。

## 設定変更

ｽﾀｯｸﾁｬﾝが使うモータの種類やピンアサインなどをマニフェストファイルから変更できます。
ユーザが変更する設定は[`stack-chan/firmware/host/app/manifest_local.json`](../host/app/manifest_local.json)にまとまっています。
`"config"`キーの配下に次のような設定が書けます。

`manifest_local.json` は、私設 IP アドレス、API キー、ベンチ固有のサーボ設定をコミットしないため、空の `"config"` として管理しています。
ローカルの driver 設定を追加せずにビルドした場合、firmware は platform/app の既定値を使います。
汎用ベンチ環境では既定のシリアルサーボ driver が選ばれる可能性があるため、異なる driver を使う場合は `config.driver.type` を明示してください。

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
| tts.volume        | TTS を再生する時の音量                        | 0~1                                         |

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

## 基本プログラム（ホスト）の書き込み

前述の通りｽﾀｯｸﾁｬﾝのファームウェアは基本プログラム（ホスト）とユーザアプリケーション（MOD）から構成されます。
次のコマンドで、標準構成の M5StackChan CoreS3 ホストをビルドして書き込みます。

_コマンドに`sudo`をつける必要はありません。_

```console
$ npm run flash
```

ビルドだけ確認したい場合は `npm run build` を使います。
ビルドしたプログラムと中間生成物は `firmware/dist/bin/` と `firmware/dist/tmp/` 配下に保存されます。
ホストアプリケーション名は `stack-chan-host` です。
`npm run clean` を実行すると、`firmware/dist/` 配下の生成物をすべて削除できます。
`npm run bundle` は例外で、`mcbundle` が生成する標準デバイス向け中間生成物は `$MODDABLE/build/` に保存されます。

### Stack-chan サブプラットフォーム

Stack-chan の各ハードウェア構成は、サーボの driver 種別とバスのピンをあらかじめ定義した**サブプラットフォーム**を同梱しています。汎用 `--target=` コマンドではなく、次の npm スクリプトを使ってください。サブプラットフォーム（`-p esp32:./host/platforms/<board>`）と対応するアプリ manifest が自動的に選択されます。

| 用途                      | M5StackChan CoreS3 | Stack-chan RT | タカオ版 Core2 + SG90 |
| ------------------------- | ------------------ | ------------- | --------------------- |
| ビルドのみ                | `npm run build` または `npm run build:m5stackchan_cores3` | `npm run build:stackchan_rt` | `npm run build:takao_core2_sg90` |
| ビルドから書き込みまで    | `npm run flash` または `npm run flash:m5stackchan_cores3` | `npm run flash:stackchan_rt` | `npm run flash:takao_core2_sg90` |
| deploy task を実行        | `npm run deploy` または `npm run deploy:m5stackchan_cores3` | `npm run deploy:stackchan_rt` | `npm run deploy:takao_core2_sg90` |
| デバッグ（xsbug）         | `npm run debug` または `npm run debug:m5stackchan_cores3` | `npm run debug:stackchan_rt` | `npm run debug:takao_core2_sg90` |
| MOD の書き込み            | `npm run mod -- [modのパス]` または `npm run mod:m5stackchan_cores3 -- [modのパス]` | `npm run mod:stackchan_rt -- [modのパス]` | `npm run mod:takao_core2_sg90 -- [modのパス]` |

ボード固有の driver 種別とサーボバスのピンは、各サブプラットフォームの manifest にまとまっています。

- M5StackChan CoreS3: [`host/platforms/m5stackchan_cores3/manifest.json`](../host/platforms/m5stackchan_cores3/manifest.json) — `m5stackchan` driver、シリアル TX6 / RX7。
- Stack-chan RT: [`host/platforms/stackchan_rt/manifest.json`](../host/platforms/stackchan_rt/manifest.json) — `dynamixel` driver、シリアル TX7 / RX6。
- タカオ版 Core2 + SG90: [`host/platforms/takao_core2_sg90/manifest.json`](../host/platforms/takao_core2_sg90/manifest.json) — `pwm` driver、pan PWM19 / tilt PWM27。

Wi-Fi 認証情報や API キーなどのデバイス固有の設定は、各ボードのアプリ manifest の `"config"` 配下に書いてください。秘密情報はコミットせず、ローカルにのみ追加してください。起動時のログ `[dynamixel] serial port=1 tx=7 rx=6 baud=1000000` で RT が実際に使うシリアルピンを確認できます。

正しく書き込めていれば起動から数秒後にｽﾀｯｸﾁｬﾝの顔が表示されます。
M5Stack のボタンを押すと次のように変わります。

- A ボタン（CoreS3 の場合は画面左下の領域） ... ｽﾀｯｸﾁｬﾝが 5 秒おきにランダムな方向を見る
- B ボタン（CoreS3 の場合は画面中央下の領域） ... ｽﾀｯｸﾁｬﾝが左、右、下、上を向く
- C ボタン（CoreS3 の場合は画面右下の領域） ... ｽﾀｯｸﾁｬﾝの顔の色が反転する

## デバッグ

次のコマンドで、選択したホストを Moddable のデバッガで起動できます。

```console
$ npm run debug
```

Stack-chan RT やタカオ版 Core2 + SG90 では、上の表にあるボード別の debug script を使います。
このコマンドはModdableのデバッガ`xsbug`を開き、M5Stackと接続します。

![xsbug](./images/xsbug.png)

`xsbug`を使うとログの確認やブレークポイントの設定（プログラムの特定行で一時停止する）、ステップ実行（プログラムを1行ずつ実行する）などができます。
`xsbug`の詳しい使い方は[公式ドキュメント（英語）](https://github.com/Moddable-OpenSource/moddable/blob/public/documentation/xs/xsbug.md)を参照してください。

## （オプション）ユーザアプリケーション（MOD）の書き込み

次のコマンドでユーザアプリケーション（MOD）の書き込みを行います。

_コマンドに`sudo`をつける必要はありません。_

```console
$ npm run mod -- [modのマニフェストファイルのパス]
```

標準のコマンドは、JavaScript module を解決する MOD manifest を対象にします。
ESP32 と lin target では、Moddable toolchain 経由で TypeScript module も扱えます。
WASM host で確認する場合も、`lin` など TypeScript 対応済み target で build した `.xsb` または archive を読み込ませます。

書き込み後は、MOD が製品既定動作の代わりに実行されます。
ボタンや画面操作の意味は、インストールした MOD の実装で決まります。

**例: [`mods/examples/look_around`](../mods/examples/look_around/)をインストールする**

```console
$ npm run mod -- ./mods/examples/look_around/manifest.json

> stack-chan@0.2.1 mod
> node scripts/firmware.mjs mod ./mods/examples/look_around/manifest.json

# xsc mod.xsb
# xsc check.xsb
# xsc mod/config.xsb
# xsl look_around.xsa
Installing mod...complete
```

## (オプショナル)フラッシュ領域の消去

MODを書き込み後、MODを書き込む前の挙動に戻したい時は、次のコマンドで書き込んだMODを消去することができます。

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
