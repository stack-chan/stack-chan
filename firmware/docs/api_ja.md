# API

APIの詳しいドキュメントは現在作成中です。

ｽﾀｯｸﾁｬﾝのソースコードには `TSDoc` 形式のコメントがついています。
次のコマンドを実行することで`docs/api`ディレクトリ配下にドキュメントを生成できます。

```console
$ npm run generate-apidoc
```

## クラス構成

ｽﾀｯｸﾁｬﾝの機能にアクセスするには`Robot`クラスを使います。
ｽﾀｯｸﾁｬﾝの機能の差し替えやカスタマイズができるように、次のクラスが定義されています。

- [Renderer](#renderer): 顔の描画
- [Driver](#driver): モータ等の駆動
- [TTS](#tts): 音声合成

// TODO: クラス図と説明

## Robot

## Renderer

## Driver

## TTS

- [TTS（音声合成）の使用](./text-to-speech_ja.md)