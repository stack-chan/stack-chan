# Shape顔アセット形式

## 対象

**Shape顔アセット**は、Stack-chanの`FaceBase`を拡張したFace実装をブラウザ上で設計するためのデータです。

形式識別子は`tech.stackchan.face`、現在のバージョンは`1`です。

推奨拡張子は`.stackchan-face.json`、MIME型は`application/vnd.stackchan.face+json`です。

機械検証用の定義は[`face-asset.schema.json`](./face-asset.schema.json)にあります。

## 生成されるFace

バージョン1は、Face領域と左右の`Eye`、`Mouth`の寸法を保持します。

Visual Programmingエディタはアセットから`FaceBase.template`を使うFace実装を生成し、次の契約で現在のFaceを置き換えます。

```js
robot.ui.setFace(new _StackchanVisualShapeFace({}));
```

生成した目と口は既存の`FaceState`を受け取るため、表情、まばたき、視線、口の開閉、テーマ色へ追従します。

## フィールド

- **kind**：バージョン1では`shape`です。
- **canvas**：320×240画面内でFaceを配置する左、上、幅、高さです。
- **shape.eyes.left**：左目の中心、瞳半径、まぶたの幅と高さです。まぶたは目と同じ中心に置かれ、幅と高さは瞳の直径以上でなければなりません。
- **shape.eyes.right**：右目の中心、瞳半径、まぶたの幅と高さです。まぶたは目と同じ中心に置かれ、幅と高さは瞳の直径以上でなければなりません。
- **shape.mouth**：口の中心、開口時と閉口時の幅、開口時と閉口時の高さです。`minWidth`は開口時、`maxWidth`は閉口時、`minHeight`は閉口時、`maxHeight`は開口時に使います。
- **emotion**：Faceを適用した直後の表情です。
- **colors**：Faceを適用した直後の主色と背景色です。
- **mouth**：Faceを適用した直後の口の開度です。

目と口の座標は`canvas`の左上を原点とします。

Face領域は320×240画面からはみ出せません。

各部品の座標と寸法もFace領域内で検証します。まぶたを含む目の外接矩形がFace領域からはみ出す値は受け付けません。

## MODへの格納

Visual Programmingエディタは、Shape顔アセットを`assets/*.stackchan-face.json`として通常のMOD resourcesへ埋め込みます。

同時に、Face実装と`robot.ui.setFace`呼び出しを`mod.js`へ生成します。

専用ランタイムや専用ファームウェアは必要ありません。

## Image型との境界

バージョン1はShape型だけを対象とします。

画像フレーム、感情ごとの画像対応、まばたきや口パク用スプライトは、既存の`ImageAvatarPack`契約を利用します。

画像アップロードを顔アセット形式へ統合するときは、`kind: image`を持つ新しい形式バージョンとして追加します。
