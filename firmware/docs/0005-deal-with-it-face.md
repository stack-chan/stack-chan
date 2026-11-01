# Deal with it

本体の顔メニューで「Deal with it」を選ぶと、simple faceの両目だけを1枚のピクセルサングラスに置き換えます。口・背景・呼吸などの振る舞いはsimple faceと同じです。起動時に使う場合は設定を次のようにします。

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

サングラスは、横長で浅い段差状フレームと、各レンズに白・黒・白の順で並ぶ斜め反射を持つ自作のピクセル画です。各白斜線は1論理px幅で、間に1論理px幅の黒斜線を置きます。全体は31×6格子で、1論理pxを8×8画面pxの矩形として描きます。周囲に2px幅の白い段差状輪郭を加えます。輪郭の外側とブリッジの空隙は透過です。輪郭は角形の膨張処理で作り、平滑化や角丸処理は行いません。

生成PNGは252×52で、画面の(34,67)へネイティブ解像度で描画します。顔領域を左右へ26pxずつ広げて252×120とし、口の相対位置も26px補正してSimpleFaceと同じ画面位置を保ちます。顔交換時は既存の `preservePositionOnSwap = false` を用い、この中央配置を保持します。口はsimple faceと同じ `Mouth({ cx: 100, cy: 88 })` で、頭部や別の口スプライトは追加しません。画像自体はまばたき・視線・感情・配色変更で変形せず、口パクと顔全体の呼吸移動は既存の仕組みで動作します。FaceViewの既存Die領域が呼吸用の余白を確保します。

既存のWeb顔エディタは左右別のShape部品を生成する形式です。このプリセットは本体の顔メニューまたは上記MODコードから選択します。Shape顔JSON・DSLへの画像機能の追加はありません。

## 参照と再生成

商用利用不可の参考画像そのもの、トレース、画素抽出、リサイズした派生物は同梱・再配布しません。製品アセットは画像ファイルを入力にせず、独自の寸法と配置で作成しています。参照画像に商用利用許諾があるとは扱いません。

`host/modules/ui/assets/images/faces/deal-with-it/generate.py` に独自の形状・ハイライト配置と輪郭生成処理があります。Pillowを導入してこのファイルを実行すると、黒・白・完全透過のみのPNGを再生成できます。生成ソースと自作PNGはリポジトリのApache-2.0で提供します。これは参照画像自体へのライセンス付与や、参照画像の利用許諾を示すものではありません。

ミームの背景資料: [Know Your Meme: Deal With It](https://knowyourmeme.com/memes/deal-with-it)。[Shades (cutout)](https://knowyourmeme.com/photos/2439321-deal-with-it) は別の作例で、このPNGの入力や画素配置の転記には使用していません。これらのWeb画像も再配布許諾を確認できていないため同梱しません。

## CPUでの描画検証

SDKツールが利用可能な環境で、`firmware/` から `npm run test:deal-with-it-face-render` を実行します。LinuxのヘッドレスPiu/Pocoで静止、閉眼・視線・感情変更、口パク、明暗背景、6pxの呼吸移動を描画し、部分更新と全体更新の画素一致を検査します。閉じた口と開いた口を未変更のSimpleFaceと比較します。生成フレームは `firmware/dist/deal-with-it-render/*.rgba`（320×240、Linux上ではBGRAバイト順）です。

M5StackChan CoreS3実機での表示は確認済みです。口パク・呼吸・顔切替など、他の機能をすべて実機で確認したわけではありません。上記のCPU描画検証と区別してください。
