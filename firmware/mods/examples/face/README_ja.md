# 顔とメニューの拡張

公開 SDK の `stackchan/extensions/ui` を使う例です。本体 API 4 以上で動作します。

- 3 秒ごとに happy / angry / sad / sleepy と吹き出しを切り替え、sleepy の間は眠気の装飾を表示します。
- 別の周期で顔の色を変えます。タイマー、装飾、メニューはアプリ終了時に回収されます。
- `strings/*.json` の翻訳を、本体で選んだ言語のメニューに使います。旧 localized_drawer の機能をこの例へ統合しました。

`mod.js` の states の文章や感情を変えて試してください。画面の配置とフォントは本体の共通表示を使います。実機とシミュレーターの入口は同じです。

firmware ディレクトリーで `npm run mod -- mods/examples/face/manifest.json` を実行します。
