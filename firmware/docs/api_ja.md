# API

[English](./api.md)

APIの詳しいドキュメントは現在作成中です。

ｽﾀｯｸﾁｬﾝのソースコードには `TSDoc` 形式のコメントがついています。
このリポジトリでは、Node.js 側の検査と API ドキュメント生成のために `firmware/tsconfig.json` を保持しています。

次のコマンドを実行すると、`docs/api` ディレクトリ配下にドキュメントを生成できます。

```console
$ npm run generate-apidoc
```

## 構成

MODは`onContextCreated`から`StackchanContext`を受け取ります。
`StackchanContext`は、UI、motion、speech、inputの実装を独立して差し替えられるように、少数のcapabilityを公開します。

- [StackchanContext](#stackchancontext): MODに渡されるruntime capabilityの集合
- [RobotUI](#robotui): Piu Application、顔、エフェクト、ドロワーUIの制御
- [Motion capability](#motion-capability): 公開 motion API による首姿勢と視線移動の制御
- [Audio capability](#audio-capability): 公開 audio API による音声再生

// TODO: capability図と説明

## 座標系

![ｽﾀｯｸﾁｬﾝの座標系](./images/coordinate.jpg)

ｽﾀｯｸﾁｬﾝの座標系は __右手系__ です。
右手の親指、人差し指と中指がそれぞれ直行するように曲げたとき、
親指がX軸、人差し指がY軸、中指がZ軸となります。

ｽﾀｯｸﾁｬﾝの顔が正面を向いているとき、各軸の正の方向は次のとおりです。

- X軸の正方向…顔の前側
- Y軸の正方向…顔の左側
- Z軸の正方向…頭側

また、回転の向きは軸の正の方向に対して右ねじが進む向きとなります。
ｽﾀｯｸﾁｬﾝの顔でいうと、各軸の周りを正の方向へ回転する場合次のようになります。

- ロール軸（X軸まわりの回転）の正方向…ｽﾀｯｸﾁｬﾝから見て時計回りに首をかしげる動き
- ピッチ軸（Y軸まわりの回転）の正方向…ｽﾀｯｸﾁｬﾝが下を向く動き
- ヨー軸（Z軸まわりの回転）の正方向…ｽﾀｯｸﾁｬﾝが左を向く動き

ｽﾀｯｸﾁｬﾝのAPIにおいては __座標の単位はメートル、角度の単位はラジアンになります__ 。
座標系との対応は実際のソースコード（[`mods/examples/look_around`](../mods/examples/look_around/)など）も参考にしてください。

## 型

### StackchanContext

### RobotUI

### Motion capability

公開 motion API は、`pose`、`lookAt`、`lookAway`、`setPose`、`setTorque` を提供します。
低レイヤの driver object は `host/modules/motion` の内部実装であり、MOD には公開しません。

### Audio capability

公開 audio API は、MOD に渡す capability object から音声再生機能を提供します。
local、remote、Voicevox、ElevenLabs、OpenAI などの provider object は `host/modules/audio` の内部実装です。

- [TTS（音声合成）の使用](./text-to-speech_ja.md)
