# ミニアプリサンプル: ｽﾀｯｸﾁｬﾝ JUMP

Piu の `Port` を使った、offline dino風のジャンプゲームです。
画面をタップするとｽﾀｯｸﾁｬﾝがジャンプします。
障害物を越えるたびにスコアと移動速度が上がり、衝突後にもう一度タップすると再スタートします。
終了するときは、常に表示されるAppBar左上の「戻る」ボタンを使います。

ゲーム領域は単一の `Port` で描画し、プレイヤーと障害物の周辺だけを再描画します。
Piuオブジェクトを多数重ねず、組み込みターゲットでの表示ツリーと再描画の負荷を抑えるためです。

通常の `mod` ではなく `miniapp` モジュールを含むarchiveとしてビルドされます。
対応firmwareにインストールして再起動し、顔をタップすると、顔画面のAppBarにアプリ一覧ボタンが現れます。

## スプライト

`assets/stack-chan.png` は [meganetaaan/mouse-followerのスプライト](https://github.com/meganetaaan/mouse-follower/blob/3258fc6d0890019a3c94024e3a456175cd563a6a/packages/mouse-follower/assets/stack-chan.png)
（commit `3258fc6d`）を元にしています。
元画像の緑色の背景だけを透過へ変換し、スプライトの非背景ピクセルは変更していません。
配布条件は [LICENSE.mouse-follower](./LICENSE.mouse-follower) を参照してください。

この実行方式はexperimentalです。
Compartmentはimportとglobalを制限しますが、生のPiuオブジェクトをホストの表示ツリーへ接続するため、未信頼コードに対する完全なsandboxではありません。
