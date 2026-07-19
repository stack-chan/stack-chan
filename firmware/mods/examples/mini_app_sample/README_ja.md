# ミニアプリサンプル

Piu の `Port` を使って、AppBar 下のミニアプリ領域にアニメーションを描画するサンプルです。

通常の `mod` ではなく `miniapp` モジュールを含む archive としてビルドされます。対応 firmware にインストールして再起動し、顔をタップすると、顔画面の AppBar にアプリ一覧ボタンが現れます。

この実行方式は experimental です。Compartment は import と global を制限しますが、生の Piu オブジェクトをホストの表示ツリーへ接続するため、未信頼コードに対する完全な sandbox ではありません。
