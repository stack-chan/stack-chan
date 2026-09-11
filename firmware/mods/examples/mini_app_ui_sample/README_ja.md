# ミニアプリサンプル: UI Playground

Piuの基本部品だけで、選択肢、区切り線、説明オーバーレイ、一時通知を表示するミニアプリです。
テーマカラーを選ぶと画面下に通知が出ます。「説明」でオーバーレイを開き、「終了」で顔画面へ戻ります。

`firmware/`から次のコマンドでビルドまたは実機へ書き込めます。

```sh
npm run mod:build -- mods/examples/mini_app_ui_sample/manifest.json
npm run mod -- mods/examples/mini_app_ui_sample/manifest.json
```

`mod.ts` が `stackchan/extensions/piu` の `definePiuApp` で画面を登録します。画面本体は `screen.ts` です。host API 3、app API 2、`ui.piu` が必要です。画面に渡る `context.app` は基本 SDK と同じもので、viewport と「戻る」はホストが管理します。旧 miniapp 専用 archive は再生成してください。
