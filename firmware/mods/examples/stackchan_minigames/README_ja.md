# ミニアプリサンプル: ｽﾀｯｸﾁｬﾝ ミニゲーム集

1つのmini-app archiveから、次の2本をミニアプリ一覧へ登録するサンプルです。

- `ｽﾀｯｸﾁｬﾝ JUMP`: タップで障害物を飛び越えるアクションゲーム
- `ｽﾀｯｸﾁｬﾝ CATCH`: 左右3レーンで通常アイテムを受け取り、爆弾を避けるゲーム&ウォッチ風ゲーム

実行コードは既存の[`mini_app_sample`](https://github.com/stack-chan/stack-chan/tree/develop/firmware/mods/examples/mini_app_sample)と[`stackchan_catch`](https://github.com/stack-chan/stack-chan/tree/develop/firmware/mods/examples/stackchan_catch)を正本とし、`compose.mjs`でimport制限に適合する単一の`miniapp.ts`へ合成しています。各ゲームのルールや描画方式は、それぞれのREADMEを参照してください。

ソースを変更した場合は`firmware/`から合成とarchive buildを実行します。

```console
node mods/examples/stackchan_minigames/compose.mjs
npm exec biome format --write mods/examples/stackchan_minigames/miniapp.ts
npm run mod:build -- mods/examples/stackchan_minigames/manifest.json --mode=release
```

タイマーは各ゲームの`Port`が非表示になったときに停止します。終了にはホスト所有のAppBar「戻る」ボタンを使います。外部mini-app APIは本体ボタン能力を公開しないため、操作は画面タップのみです。

## スプライトの出典

JUMPの`stack-chan.png`は[meganetaaan/mouse-follower](https://github.com/meganetaaan/mouse-follower/blob/3258fc6d0890019a3c94024e3a456175cd563a6a/packages/mouse-follower/assets/stack-chan.png)（commit `3258fc6d`）を元にしています。CATCHのプレイヤーポーズも同画像をデザイン参照として作成しています。配布条件は[LICENSE.mouse-follower](./LICENSE.mouse-follower)を参照してください。
