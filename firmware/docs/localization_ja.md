# Firmware のローカライズ

[English](./localization.md)

Firmware は日本語（`ja`）、英語（`en`）、簡体字中国語（`zh-CN`）に対応します。
host と MOD は同じ `context.i18n` API を使えますが、辞書リソースは分離されています。

## 公開 API

MOD は `onContextCreated` で渡される `StackchanContext` から現在の locale と翻訳済み文字列を取得します。

```ts
context.i18n.locale
context.i18n.localize(key, values?)
```

`localize` は `this` に依存しないため、次のように取り出して使えます。

```js
export function onContextCreated(context) {
  const { localize } = context.i18n
  context.ui.drawer.addDrawerButton({
    key: 'weather:forecast',
    label: localize('weather.drawer.forecast'),
    callback(nextContext) {
      nextContext.ui.closeDrawer()
    },
  })
}
```

文字列の解決順は次のとおりです。

1. インストールされた MOD の `modLocals`
2. host の `locals`
3. 未定義のキー文字列そのもの

MOD 固有キーには `weather.*` のような MOD 固有の prefix を付け、host や別の MOD との衝突を避けてください。
host の共通キーを使うだけなら、MOD 側に同じキーを重複して定義する必要はありません。

## MOD に辞書を追加する

MOD のディレクトリへ、3つの JSON ファイルを追加します。

```text
my_mod/
├── manifest.json
├── mod.js
└── strings/
    ├── en.json
    ├── ja.json
    └── zh-CN.json
```

すべての辞書に同じキーと同じ placeholder 名を定義します。
`en.json` は `Locals` の初期化にも使うため必須です。

```json
{
  "weather.drawer.forecast": "天気",
  "weather.temperature": "気温: {value}°C"
}
```

manifest の `resources` に `strings` を追加します。

```json
{
  "include": ["$(MODDABLE)/examples/manifest_mod.json"],
  "modules": {
    "*": ["./mod"]
  },
  "resources": {
    "*": ["./strings/*"]
  }
}
```

`mcrun` はこれらを MOD 専用の `modLocals.mhi` と `modLocals.<locale>.mhr` に変換します。
MOD から `Locals` や host 内部の `localization` module を直接 import せず、`context.i18n.localize()` を使ってください。
最小の実装例は [`mods/examples/localized_drawer`](../mods/examples/localized_drawer/) にあります。

## 任意の Piu Label で使う

`localize()` の戻り値は通常の `string` なので、Drawer Button 以外の `Label` にも渡せます。

```js
import { Label, Style } from 'piu/MC'

export function onContextCreated(context) {
  const status = new Label(null, {
    left: 8,
    right: 8,
    top: 40,
    height: 24,
    string: context.i18n.localize('weather.status.ready'),
    style: new Style({ font: 'OpenSans-Regular-16', color: 'black' }),
  })
  context.ui.addEffect(status, 'weather:status')
}
```

Piu の `Label.string` は生成時点の文字列であり、locale の変更を自動購読しません。
表示中に locale を変更する実装を追加する場合は、該当 `Label` の `string` を再設定するか、ビューを再構築してください。

## フォント

翻訳と glyph の収録は別の問題です。
`context.i18n.localize()` は Unicode 文字列を返しますが、表示に使うフォントへ文字が含まれている必要があります。

host の画面と Drawer は host 辞書に必要な glyph を収録した UI font を使います。
MOD 固有の CJK 文字を任意の `Label` に表示する場合は、ライセンスを確認したフォントを MOD に同梱し、manifest の font resource で `"localization": true` を指定してください。
Drawer Button は現在 host の style を使うため、MOD 固有の CJK glyph まで保証されません。
最小サンプルは host font に収録済みの文字だけを使っています。

## host の画面を追加する

host の UI では `host/app/strings/{ja,en,zh-CN}.json` の3ファイルへ同じキーを追加し、`localization` module の `localize()` を使います。
placeholder は `{name}` 形式で、各 locale で名前を一致させます。
architecture test が辞書キー、placeholder、簡体字中国語用 font の glyph を検査します。

## Moddable の公式資料

- [Piu Localization](https://github.com/Moddable-OpenSource/moddable/blob/public/documentation/piu/localization.md): `mclocal`、`Locals`、辞書 resource の仕組み
- [Mods - User Installed Extensions](https://www.moddable.com/documentation/xs/mods): MOD の manifest、resource、build の基本
- [mcrun](https://www.moddable.com/documentation/tools/tools#mcrun): MOD build tool
- [Piu Label Object](https://www.moddable.com/documentation/piu/piu#label-object): `Label` と `string` の API
- [Creating fonts for Moddable applications](https://www.moddable.com/documentation/commodetto/Creating%20fonts%20for%20Moddable%20applications): `localization: true` を含む font resource の設定
- [mcrun source](https://github.com/Moddable-OpenSource/moddable/blob/public/tools/mcrun.js#L485): MOD の辞書 resource 名が `modLocals` であること
