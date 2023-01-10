# プログラムのビルドと書き込み

## ｽﾀｯｸﾁｬﾝのプログラム構成について

ｽﾀｯｸﾁｬﾝのファームウェアは、ｽﾀｯｸﾁｬﾝの基本動作を提供するプログラム（ホスト）とユーザアプリケーション（MOD）から構成されます。
一度ホストを書き込んでしまえば、ユーザアプリケーションのインストールは短時間で終わるため高速な開発が可能です。
最初にホストを書き込み、必要に応じてMODの書き込みを行います。

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
$ npm run mod --device=esp32/m5stack_core2 [modのマニフェストファイルのパス]
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

- 👉[mods/README_ja.md](../mods/README_ja.md): 同梱のサンプルMODの紹介です。
- 👉[API](./api_ja.md): ｽﾀｯｸﾁｬﾝのAPIドキュメントです。
