# Deal with it

本体の顔メニューで「Deal with it」を選ぶと、両目の代わりに1枚のピクセルサングラスを表示します。起動時に使う場合は設定を次のようにします。

```json
{ "ui": { "type": "deal-with-it" } }
```

MODからも既存の顔交換APIで利用できます。

```js
import { DealWithItFace } from 'parts/image/deal-with-it-face'

export function onContextCreated(robot) {
  robot.ui.setFace(new DealWithItFace({}))
}
```

サングラスは48×12の自作ピクセル画をnearest-neighborで3倍にした144×36の透過PNGです。実行時は拡縮も色付けもせず、200×120の顔内の(28,24)へ描画します。既存の画像アバター `stackchan-demo` の明るい頭部を背景に使い、黒い画面でもレンズと段差状の輪郭が見えるようにしています。口も同じアバターの4フレームを使います。

まばたき・視線・感情・テーマ変更はサングラスを変形しません。口パクと顔全体の呼吸移動は継続します。FaceViewの既存Die領域が呼吸用の余白を確保します。頭部と口は元のアバター色、画面背景は現在のテーマ色です。

既存のWeb顔エディタは左右別のShape部品を生成する形式です。このプリセットは本体の顔メニューまたは上記MODコードから選択します。Shape顔JSON・DSLへの画像機能の追加はありません。

## 参照とアセット

2026-10-17に以下を確認しました。

- [Know Your Meme: Deal With It](https://knowyourmeme.com/memes/deal-with-it) — ミームとサングラス表現の背景。
- [Shades (cutout), AtlasJan投稿](https://knowyourmeme.com/photos/2439321-deal-with-it) — 黒い上部フレーム、左右の段差状レンズ、斜めのピクセル反射の目視参照。[画像URL](https://i.kym-cdn.com/photos/images/original/002/439/321/689.png)。この例は灰色の反射で、本アセットでは依頼に合わせて白にしています。

上記ページには画像の再配布を許可するライセンスが明示されていないため、第三者のPNGは同梱していません。`host/modules/ui/assets/images/faces/deal-with-it/generate.py` が新たに描いたピクセル配置の全ソースです。特定の画像の完全な複製ではなく、ミームの特徴を参考にした自作です。このソースと生成PNGはリポジトリのApache-2.0で提供します。参照画像自体にこのライセンスを付与するものではありません。

再生成にはPillowを導入して上記Pythonファイルを実行します。生成PNGは黒・白・完全透過のみで、アンチエイリアスはありません。

## CPUでの描画検証

SDKツールが利用可能な環境で、`firmware/` から `npm run test:deal-with-it-face-render` を実行します。LinuxのヘッドレスPiu/Pocoで静止、閉眼・視線・感情変更、口パク、明暗背景、6pxの呼吸移動を描画し、部分更新と全体更新の画素一致を検査します。生成フレームは `firmware/dist/deal-with-it-render/*.rgba`（320×240、Linux上ではBGRAバイト順）です。

実機への書込みと実機表示は未確認です。
