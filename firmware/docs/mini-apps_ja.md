# ミニアプリ

**ミニアプリ**は、通常の顔画面を一時的に置き換え、AppBar の下に Piu の UI を表示する小さなアプリケーションです。
このブランチでは SDK の Piu 拡張を使います。初めての MOD は [基本教材](../lessons/README_ja.md) から始め、独自画面が必要になったときにこの拡張へ進んでください。

## 画面の所有範囲

ホストは AppBar を所有し続け、ミニアプリには高さ 44 px を除いた `320 x 196` の領域を渡します。
ミニアプリのルートは `clip: true` の viewport に入るため、通常の描画は AppBar へはみ出しません。

```text
Application
├── ミニアプリ viewport（top: 44、clip: true）
│   └── ミニアプリが返した Piu Container
├── AppBar（ホスト所有）
├── Overlay（ホスト所有）
└── Drawer（ホスト所有）
```

ランチャーと実行画面では、AppBar の左上に「戻る」ボタンが常に表示されます。
ランチャーで押すと顔画面へ戻り、実行画面で押すとミニアプリを破棄して顔画面へ戻ります。

顔画面では、顔をタップすると AppBar の操作ボタンが 4 秒間表示されます。
ドロワーボタンと、ミニアプリ登録時のアプリ一覧ボタンは同時に表示・非表示となり、どちらを開くかを AppBar 上で選択します。
顔タップだけではドロワーを開きません。

## SDK から画面を宣言する

```ts
import { Container, Skin, definePiuApp } from 'stackchan/extensions/piu'

export default definePiuApp({
  screens: [{
    id: 'example.hello',
    title: 'Hello',
    create({ width, height, app, close }) {
      return new Container(null, { width, height, skin: new Skin({ fill: '#93c5fd' }) })
    },
  }],
})
```

`create` には viewport の寸法、同じアプリの基本 SDK `app`、顔へ戻る `close()` が渡ります。画面登録は通常の AppSession が所有し、アプリ停止・開始失敗時にも登録を解除します。アプリ側で raw registry や別の起動 hook を管理する必要はありません。

戻り値は Piu `Container` または `{ content, dispose }` です。表示のたびに作り直し、終了時に破棄します。`Port` のフレームタイマーは `onUndisplaying` で停止し、画面固有の購読・タイマー・ソケットなどは `dispose()` で解放してください。SDK 登録の寿命はアプリ全体なので、画面だけに属するものはその解除関数を `dispose` から呼びます。詳細は [SDK の画面契約](../sdk/README_ja.md#piu-の画面拡張) を参照してください。

## ビルドと配布

`firmware/` で `npm ci` を済ませ、通常の MOD としてビルドします。SDK の型はローカル npm workspace の TypeScript ソースを参照します。実行入口は `mod`、配布宣言は schema 2 / app API 2 / host API 3 と `ui.piu` です。

```console
npm run mod:build -- mods/examples/stackchan_minigames/manifest.json --mode=release
```

[ミニゲーム集](../mods/examples/stackchan_minigames/) は `jump.ts` と `catch.ts` を通常の相対 import で読み込み、両ゲームを一つの MOD で登録します。[UI Playground](../mods/examples/mini_app_ui_sample/) は選択肢、通知、説明オーバーレイ、終了を試す例です。Gallery の配布ソースもこれらを正本として生成します。

旧 `miniapp` モジュールの配列 export、通常 `mod` との併用、専用 Compartment は撤去しました。古い archive は起動前に拒否されるため、ソースを新しい SDK に移して再生成してください。`Application` とホスト controller は拡張から公開しませんが、MOD 自体はホストと同じ realm で動きます。この公開面の制限を未信頼コードの sandbox として扱わないでください。

## 多層 UI の性能確認

ホストが追加する Piu 階層は、AppBar を避ける一つの viewport だけです。
ミニアプリごとに `Application` を入れ子にはしません。

Core2 で階層の影響を比較するため、深さ 0、4、8、16 の同じアニメーションを順番に動かす benchmark を用意しています。

```console
npm run benchmark:mini-app-layers:build
npm run benchmark:mini-app-layers:flash
```

benchmark は 5 秒ごとに Frames Drawn、Pixels Drawn、Piu Command List Used、XS の slot と chunk の使用量を出力します。
暫定的な確認基準は、深さ 16 の frames per second が深さ 0 から 10% を超えて低下しないこと、command list が枯渇しないこと、AppBar の「戻る」操作に目視できる遅延がないことです。
閾値は Core2 実機の測定値を蓄積してから固定します。
