# ボード診断

旧 `light` と `m5stackchan_smoke` を統合した、公開SDKの例です。host API 5以上を使います。ネットワークや秘密情報は不要です。

```sh
# firmware/ から実行
npm run mod:m5stackchan_cores3 -- mods/examples/board_diagnostics/manifest.json
```

起動から1秒後に、サーボの小さい往復とLEDの赤・緑の点滅・虹・消灯を確認します。可動範囲を確保してから起動してください。メニューの「ボード診断」で繰り返せます。サーボの失敗後もLEDを確認し、未対応・失敗は画面とログに表示します。シミュレーターの結果は実機合格として扱いません。

「LED」で本体設定にある名前を選びます。CoreS3では最初に `head` を選び、その他では利用可能な最初のLEDを選びます。Aは赤→緑→青、Bは消灯、Cは虹です。ボタンの少ない機種ではメニューから同じ操作と点滅を選べます。診断中の手動LED操作は受け付けません。

サーボとLEDの生成はホスト、入力・タイマー・motionと使用したLEDの寿命はAppSessionが所有します。アプリを閉じると待機・動作を取り消し、使用したLEDを消灯します。ドライバー、Piu、Timer、旧フックはimportしません。

CoreS3の書込と手動確認、USB接続時の実行方法は [診断ガイド](../../../docs/m5stackchan-cores3-smoke.md) を参照してください。実機の受入は別途必要です。
