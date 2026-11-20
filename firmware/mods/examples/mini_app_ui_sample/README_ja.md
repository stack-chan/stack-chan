# ミニアプリサンプル: UI Playground

Piuの基本部品だけで、選択肢、区切り線、説明オーバーレイ、一時通知を表示するミニアプリです。
テーマカラーを選ぶと画面下に通知が出ます。「説明」でオーバーレイを開き、「終了」で顔画面へ戻ります。

`firmware/`から次のコマンドでビルドまたは実機へ書き込めます。

```sh
npm run mod:build -- mods/examples/mini_app_ui_sample/manifest.json
npm run mod -- mods/examples/mini_app_ui_sample/manifest.json
```

mini-appのCompartmentで許可される`piu/MC`だけを利用し、host capabilityや外部サービスは要求しません。
