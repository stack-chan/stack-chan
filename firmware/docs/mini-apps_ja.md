# ミニアプリ

**ミニアプリ**は、通常の顔画面を一時的に置き換え、AppBar の下に Piu の UI を表示する小さなアプリケーションです。
この機能は experimental であり、API と外部 archive の形式は変更される可能性があります。

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

## 組み込みアプリの登録

通常の app behavior は、`onContextCreated` で `context.ui.miniApps.register` を呼び出せます。
戻り値は登録解除関数であり、実行中のアプリを登録解除した場合もホストが顔画面へ戻してから破棄します。

```ts
import type { StackchanAppBehavior } from 'app-behavior'
import { Container, Label } from 'piu/MC'

const behavior: StackchanAppBehavior = {
  onContextCreated(context) {
    const unregister = context.ui.miniApps.register({
      id: 'example.hello',
      title: 'Hello',
      create({ width, height, close }) {
        return new Container(null, {
          width,
          height,
          contents: [new Label(null, { string: 'Hello' })],
        })
      },
    })

    // 所有元を終了するときに unregister() を呼ぶ。
  },
}

export default behavior
```

`create` は Piu の `Container`、または `{ content, dispose }` を返します。
ホストは終了時に `content.behavior.onDispose(content)` と `dispose()` をそれぞれ一度呼びます。
タイマーやソケットなど、Piu ツリーを外れて生存する資源は `dispose()` で解放してください。

## 外部 archive の形式

外部ミニアプリは、archive の `miniapp` module から定義の配列を default export します。
[サンプル](../mods/examples/mini_app_sample/)は、`Port` でアニメーションを描画します。

```ts
import type { MiniAppDefinition } from 'capabilities'
import { Container } from 'piu/MC'

const app: MiniAppDefinition = {
  id: 'example.external',
  title: 'External',
  create: () => new Container(),
}

export default [app]
```

外部 archive では `miniapp`、`piu/MC`、`piu/Timeline` だけを import できます。
`piu/MC` からは `Application` を除いた描画用 API だけが公開されます。
同じ archive に従来の `mod` module が含まれていても、ホスト realm には読み込みません。

## containment の保証範囲

Moddable の linker が作る read-only snapshot は、SES の post-lockdown に相当する状態です。
ホストは `Compartment` を作り、外部ミニアプリの global と import を制限します。
外部コードへ渡す追加の global は、その archive 内のリソースを読むための `archive` だけです。
`Modules`、ネットワーク、デバイス I/O、ホストの `Application` は渡しません。

しかし、この構成は「未信頼コードに対する完全な sandbox」を保証しません。
その理由は、Compartment 内で作った生の Piu オブジェクトをホストの表示ツリーへ接続するためです。
Piu の constructor と prototype もホストと共有するため、親子参照、イベント配送、prototype の変更を通じてホスト側へ影響しないことは、現在の API では証明できません。

したがって、現段階の外部ミニアプリは信頼できるコードだけをインストールしてください。
未信頼コードを扱うには、描画コマンドを検証する membrane を挟むか、別の XS machine で実行して表示リストだけを受け取る設計が必要です。

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
