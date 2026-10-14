# JitomeFace (M5Stack CoreS3)

承認済み320×240プレビューの単色Face。髪・帽子・顔外周・鼻・下まぶたは描画しません。
本体の組み込みFaceとしてDrawerから「ジト目」を選択できます。標準起動FaceはSimpleのままです。

画面全体を使うため、Behaviorの`preservePositionOnSwap = false`で前のFaceの座標を引き継がず、画面原点(0,0)へ配置します。他のFaceは従来どおり交換前の位置を引き継ぎます。

```json
{
  "ui": { "type": "jitome" }
}
```

## 見た目と動き

内部の基準座標（左右眼中心x=102.5／217.5、上まぶたy=127、眉y=112.5、口中心(160,174)）を、顔中心(160,144)の周りで一律1.5倍に拡大して320×240画面へ描画します。さらに左右の目一式を拡大後に各4px中央へ寄せるため、最終的な左右眼中心はx=77.75／242.25、上まぶた幅61.5px、虹彩幅約48px、口中心y=189、口幅18pxになります。

FaceStateの開眼量1で通常のジト目、0で閉眼します。瞬きでは虹彩の点列を変更せず、背景色のまぶたとまつ毛を下降させて覆います。眉は基準で最大2px（拡大後3px）下降します。視線入力だけが虹彩を変えます。口パクは幅を維持して開口量を変え、静止時は小さな楕円です。テーマは既存FaceStateに従います。感情別の別造形、呼吸・回転・伸縮は追加していません。

33ms間隔の自動瞬きを備え、90msで閉じ、45ms閉眼を保ち、200msで開きます。周期は約2.8～5秒。瞬き中に自動視線は加えません。外部視線・左右別開眼・口パクに対応します。`robot.ui.setFaceMotionEnabled(false)`で自動瞬きを停止して入力を直接描画します。非表示・Face交換時はタイマーを停止します。

## 最適化

参照作業のParametricFace最適化結果を踏まえ、30fps相当、固定レイアウト、26.6精度への量子化、変更部品のみ更新、旧・新boundsの部分invalidateを採用しました。部品は左右それぞれ虹彩・マスク・まぶた＋まつ毛・眉、および口です。入力不変なら点生成を省略し、描画も要求しません。

Moddable 9.5.0の公式`Outline.clone(destination)`で、9個の不変な基準Outlineを10個の描画用Outlineへコピーしてから平行移動・拡縮します。描画用Outlineと10個のShapeは起動時に確保し、`fillOutline`は一度だけ設定します。口の上下は基準線に対する倍率がわずかに異なるため、同じ口Outlineを上下2個のShapeへ割り当てて基準線でクリップします。これにより現行の非対称なcubic輪郭を保ちます。毎tickでPath、Outline、配列、TypedArrayを生成しません。

Shapeに非公開APIを追加せず、最前面の透明なPiu Portから標準`Port.invalidate(x, y, width, height)`を呼び、背後のShapeをdirty領域だけ再描画します。まぶたのマスクは上端固定なので、下端が通過する帯だけをinvalidateします。大きなマスク全体、左右の間、画面全体を周期的に描き直しません。虹彩は瞬きだけでは更新されません。曲線はサンプリングした多数の線分ではなくcubicのfill輪郭を使います。

汎用のばね・回転・376点の再計算を持つParametricFaceとは異なり、小さな固定モデルのためJSのままです。native一括化・スプライト化は追加していません。

## CoreS3実測（2026-09-05）

Moddable 9.5.0、ESP-IDF 6.1、M5Stack CoreS3（ESP32-S3 rev 0.2、240MHz）で顔単独のinstrumentビルドを測定しました。各区間18秒のうち先頭5個の1秒サンプルを除外し、残り13サンプルを集計しています。CPUはJitomeFace専用時間ではなく各コア全体の非idle率、FPSはLCD走査ではなくPiu/Pocoのフレーム送信数です。

| 条件 | CPU0 平均／最大 | CPU1 平均／最大 | 描画FPS 平均（範囲） | Pixels/s 平均 | GC |
| --- | ---: | ---: | ---: | ---: | ---: |
| 静止 | 0.00%／0% | 4.00%／4% | 0.00 | 0 | 0 |
| 同一FaceStateを30fps投入 | 0.08%／1% | 6.00%／6% | 0.00 | 0 | 0 |
| 連続瞬き30fps | 0.46%／1% | 72.23%／73% | 29.08（28–30） | 90,947 | 0 |
| 全パーツ連続更新30fps | 0.46%／1% | 88.54%／94% | 27.15（24–29） | 196,441 | 0 |

静止入力の早期returnは有効で、FaceState配送だけなら描画を発生させません。連続瞬きはほぼ30fpsを維持しますが、更新コアの負荷は約72%です。左右開眼・4方向視線・口を毎フレーム同時に変える最悪ケースは更新コアが飽和し、平均27.15fpsまで下がりました。通常の自動瞬きは約2.8～5秒の静止区間を挟むため、連続瞬き区間は通常時の平均CPUを示すものではありません。

解析区間内ではSlot使用量53,632 bytesが一定、Chunk使用量も各区間内で一定、GCは全区間0回でした。生ログと機械集計は`dist/jitome-face-benchmark/run.log`と`result.json`へ出力します。

## ビルド

公式Moddable SDK 9.5.0以降を使用します。SDKソースへの独自パッチは不要です。9.5.0時点の型定義は`clone(destination)`を宣言していないため、アプリ側のローカルinterfaceだけで差分を補います。

```sh
# 公式9.5.0 SDKのMODDABLE、mcconfigのPATH、ESP-IDF 6.1環境を設定しfirmware/で実行
npm run test:jitome-face-render
npm run build:m5stack_cores3
npm run benchmark:jitome-face:build:cores3
UPLOAD_PORT=/dev/ttyACM0 npm run benchmark:jitome-face:flash:cores3
UPLOAD_PORT=/dev/ttyACM0 npm run benchmark:jitome-face:capture:cores3
```

新しいhost moduleを含むホスト更新が必要です。CoreS3単体用は`m5stack_cores3`で、サーボ付きの`m5stackchan_cores3`とは別です。9.5.0未満ではDrawerのジト目項目を表示せず、通常のFaceを維持します。`ui.type: "jitome"`を明示した場合はSDKバージョン不足を説明するエラーになります。

以下は接続機器へ書き込む操作です。検証済みホストを用意してから、対象ポートを確認して実行します。

```sh
UPLOAD_PORT=/dev/ttyACM0 npm run deploy:m5stack_cores3
```

## 検証

XS/Piuをheadless screenで実行し、公式`clone(destination)`の再利用、虹彩の不変性、完全閉眼、眉の下降、Outline／buffer identity、不変入力時の更新省略を検証します。16状態（閉眼・再開眼・左右別開眼・視線・口パク・白黒反転）について、部分再描画と強制全再描画のフレームバッファ全バイト一致を確認します。テスト生成物は`dist/jitome-face-render/`です。

調整：左右の目一式を拡大後の座標で各4px中央へ寄せています。口の制御点中央を下向きに0.75px（曲線中央の変位約0.56px）曲げ、入力開口量に応じて開口高さを最大5%増やしました。
