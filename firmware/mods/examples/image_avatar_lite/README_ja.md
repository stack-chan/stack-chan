# 画像アバターを選ぶ

6 種類のキャラクターを表示する SDK アプリです。主に編集するファイルは [mod.js](mod.js) です。画像の配置を作り変える場合だけ [image-avatar-lite-packs.js](image-avatar-lite-packs.js) を編集します。内部の Piu や face controller を使わず、同じ `setup(app)` の中で表示・ボタン・メニューを組み合わせます。

Moddable 9.5 対応の環境と host API 6 以上の本体を使います。[firmware の導入手順](../../../README_ja.md) を済ませてから、`firmware/` で実行してください。

```sh
npm run mod -- mods/examples/image_avatar_lite/manifest.json
```

ブラウザーでは `npm run mod:build -- mods/examples/image_avatar_lite/manifest.json` で作った `dist/bin/esp32/debug/image_avatar_lite/image_avatar_lite.xsa` を、同世代のシミュレーターの「MODを追加」から読み込みます。

起動すると slime を表示します。A（主入力）を押すたびに puipui、jack-o-lantern、girl、robot、kaeru、slime と切り替わります。メニューの「画像アバター」でも選べます。「表情を変える」は `neutral / angry / sad / happy / sleepy / doubt / cold / hot` を順に指定します。同じ画像を複数の表情に割り当てたキャラクターでは、見た目が変わらない場合があります。

最初の改造では `mod.js` の `showPack('image-avatar-lite-slime')` を `showPack('image-avatar-lite-kaeru')` に変更してください。表情を固定するには、その次に `app.face.setEmotion('happy')` を追加します。主入力の切り替えとメニューは同じ選択状態を使います。

## 自分の画像を使う

`ui(app).setImageAvatar(pack)` にパック全体を渡します。パックの型は `stackchan/image-avatar` の `ImageAvatarPack` です。ID はデータの識別子で、グローバルな登録処理や名前によるホスト設定はありません。

静止パーツは `texture / x / y / width / height` を指定します。目と口も同じ形式で、横並び PNG の枚数を `frameCount` に指定します。`width / height` は一枚分の大きさです。閉じた状態が先頭、開いた状態が末尾のフレームになります。画像名・サイズを別の sheet オブジェクトへ重ねて書く必要はありません。

`expressions` に頭・左右の目・口・左右の手をまとめ、`emotionMap` で SDK の表情名をそのキーへ対応させます。未指定の表情は `defaultExpression` を使います。表示枠は最大 320×240、表情は 1〜16 個、フレームは 1〜32 枚です。座標は整数の −1024〜1024、パーツサイズは 1〜1024、PNG の横幅は最大 4096 とします。画像名はパスなしの英数字・`_`・`-` と `.png` です。PNG はこの MOD の `assets/` と manifest に含めます。

パックは選択時に検証・コピーされ、そのコピーで全表情の描画素材を準備してから切り替えます。元のオブジェクトを変更しても表示中の顔は変わりません。変更を反映するにはもう一度 `setImageAvatar` を呼びます。大きさの違う顔へ切り替えても表示の中心を保ち、320×240のアバターは画面の左上から描画します。アプリを閉じるとメニューと入力の登録を解除し、本体設定の顔へ戻します。

## 失敗から戻る

- host API 不足で読み込めない場合は、本体とシミュレーターを host API 6 以上へ更新して再生成します。
- `INVALID_ARGUMENT` はパックの名前・表情の対応・整数サイズ・フレーム数を確認します。古い数値や大文字の表情キー、パック名だけの指定は使用できません。
- `IO` で画像が見つからない場合は、PNG の綴りと `assets/`・manifest を確認して再生成します。切り替えに失敗しても表示中の顔と選択値は残ります。

43 枚の元画像と 12 表情の配置を保持しています。素材のライセンスは [LICENSE-M5Core2ImageAvatarLite_AI.txt](LICENSE-M5Core2ImageAvatarLite_AI.txt) に従ってください。自動試験・シミュレーター検証と、実機でのメモリー・表示や初学者による導入受入は別に記録します。
