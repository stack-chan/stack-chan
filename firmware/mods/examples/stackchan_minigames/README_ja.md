# ミニアプリサンプル: ｽﾀｯｸﾁｬﾝ ミニゲーム集

1つの SDK MOD から、次の2本をミニアプリ一覧へ登録するサンプルです。

- `ｽﾀｯｸﾁｬﾝ JUMP`: タップで障害物を飛び越えるアクションゲーム
- `ｽﾀｯｸﾁｬﾝ CATCH`: 左右3レーンで通常アイテムを受け取り、爆弾を避けるゲーム&ウォッチ風ゲーム

実行コードの正本は `jump.ts` と `catch.ts` です。`mod.ts` が SDK の Piu 拡張から両者を通常のモジュールとして読み込みます。旧 `mini_app_sample` / `stackchan_catch` の単独 archive はこのパッケージへ統合しました。詳しいゲームのルールは旧ディレクトリーの README に残しています。

Moddable 9.5.0 を設定し、`firmware/` からビルドします。

```console
npm run mod:build -- mods/examples/stackchan_minigames/manifest.json --mode=release
```

host API 3 以降を使ってください。app API は2、実行入口は `mod` です。画面登録はアプリが所有し、viewport と AppBar「戻る」はホストが所有します。操作は画面タップで、各ゲームの `Port` が非表示になるとタイマーを停止します。画面の寿命と後片付けは [SDK 契約](../../../sdk/README_ja.md#piu-の画面拡張) を参照してください。

## スプライトの出典

JUMPの`stack-chan.png`は[meganetaaan/mouse-follower](https://github.com/meganetaaan/mouse-follower/blob/3258fc6d0890019a3c94024e3a456175cd563a6a/packages/mouse-follower/assets/stack-chan.png)（commit `3258fc6d`）を元にしています。CATCHのプレイヤーポーズも同画像をデザイン参照として作成しています。配布条件は[LICENSE.mouse-follower](./LICENSE.mouse-follower)を参照してください。
