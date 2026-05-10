- Feature Name: `image_face_from_moddable_avatar_simpleface`
- Start Date: 2026-02-07
- RFC PR: (TBD)
- Related Issue: (TBD)
- Target: Moddable SDK + TypeScript

## Summary
[summary]: #summary

`reference/moddable-avatar/src/avatar.ts` のスプライト構成を基準に、`renderers-piu` 向けの `ImageFace` を追加する。対象パーツは `Iris`（実ファイル名 `eye.png`）、`Eyelid`（`eyelid.png`）、`Mouth`（`mouth.png`）で、既存の `FaceContext` インターフェースを維持したまま描画方式だけをスプライトへ差し替える。

## Motivation
[motivation]: #motivation

現行 `renderers-piu` の `SimpleFace` は図形描画で保守しやすい一方、見た目の作り込みはコード中心になる。`moddable-avatar` の顔はスプライトで定義されており、デザイン差し替えがしやすい。これを `ImageFace` として移植すれば、`FaceContext` を変えずに顔の見た目を差し替えられる。

利用シナリオ:
- 既存の顔制御（`mouth.open`、`eyes.*.gazeX/Y`、`eyes.*.open`）を変更せずにビジュアルだけ更新したい。
- `simple` と `dog` と同様に `renderer.type` で顔種別を切り替えたい。
- 将来的にスプライト差し替えで派生顔を増やしたい。

## Guide-level explanation
[guide-level-explanation]: #guide-level-explanation

### 導入後の使い方
`renderer.type` に `image` を指定すると `ImageFace` を使う。

```json
{
  "renderer": {
    "type": "image"
  }
}
```

### 移植時の基本方針
1. `reference/moddable-avatar/assets/images/eye.png` / `eyelid.png` / `mouth.png` を取り込む。
2. `renderers-piu` に画像パーツ実装 (`parts/image/*`) を追加する。
3. 参照実装の見た目仕様を保ちつつ、入力は `FaceContext` に統一する。
4. `variant` 更新は `onTimeChanged` ベースのループを使わず、`onFaceContext` でのみ行う。

補足: 参照実装は `startSpeech/stopSpeech` と `onBlink` でパーツを動かすが、本移植では既存インターフェース優先で `mouth.open` / `eyes.*.open` / `eyes.*.gazeX/Y` からフレーム・座標を決定する。

### 非目標
- 既存 `SimpleFace` の置換・削除。
- `moddable-avatar` の API (`startSpeech`, `setFocusPoint` など) をそのまま公開すること。

## Reference-level explanation
[reference-level-explanation]: #reference-level-explanation

### 1. 参照実装の事実確認
`reference/moddable-avatar/src/avatar.ts` の構成:
- Iris: `eye-alpha.bmp`（元画像 `assets/images/eye.png`）
  - フレーム: `16x16` 1枚
  - 位置: `gaze.x/y * 8` ピクセル移動
- Eyelid: `eyelid-alpha.bmp`（元画像 `assets/images/eyelid.png`）
  - シートサイズ: `168x24`
  - 1フレーム: `24x24`、横 7 コマ
  - 参照実装はまばたき時に variant を進める
- Mouth: `mouth-alpha.bmp`（元画像 `assets/images/mouth.png`）
  - シートサイズ: `480x40`
  - 1フレーム: `80x40`、横 6 コマ
  - 参照実装は発話中ループアニメーションで variant を進める

### 2. アセットコピー先
コピー元:
- `reference/moddable-avatar/assets/images/eye.png`
- `reference/moddable-avatar/assets/images/eyelid.png`
- `reference/moddable-avatar/assets/images/mouth.png`

コピー先:
- `stackchan/assets/images/faces/image-face/moddable-avatar/eye.png`
- `stackchan/assets/images/faces/image-face/moddable-avatar/eyelid.png`
- `stackchan/assets/images/faces/image-face/moddable-avatar/mouth.png`

命名を `moddable-avatar` 配下に分離し、既存アセットとの衝突を避ける。
`eyelid.png` は `24x24 x 7` のタイル幅/フレーム数を維持したまま、`open -> close -> open` になる並びで再構成する。

### 3. マニフェスト更新
`stackchan/renderers-piu/manifest_renderer_piu.json`:
- `resources["*-alpha"]` に以下を追加
  - `"../assets/images/faces/image-face/moddable-avatar/eye"`
  - `"../assets/images/faces/image-face/moddable-avatar/eyelid"`
  - `"../assets/images/faces/image-face/moddable-avatar/mouth"`
- `modules` と `preload` に `renderer-image` を追加

### 4. ファイル構成
追加案:

```text
stackchan/
  assets/
    images/
      faces/
        image-face/
          moddable-avatar/
            eye.png
            eyelid.png
            mouth.png
  renderers-piu/
    renderer-image.ts
    behaviors/
      face.ts
    parts/
      image/
        atlas.ts
        eye-sprite.ts
        iris-sprite.ts
        eyelid-sprite.ts
        mouth-sprite.ts
```

更新:
- `stackchan/main.ts` (`renderers` map に `image` 追加)
- `stackchan/renderers-piu/manifest_renderer_piu.json`

### 5. クラス構成
- `ImageFace` (`behaviors/face.ts`)
  - `FaceBase` を利用
  - `EyeSprite(left/right)` と `MouthSprite` を配置
- `EyeSprite` (`parts/image/eye-sprite.ts`)
  - `IrisSprite` + `EyelidSprite` を内包
  - `gazeX/Y` を `* 8` して `IrisSprite` に反映
- `IrisSprite` (`parts/image/iris-sprite.ts`)
  - 16x16 テクスチャを表示
  - `theme.primary` を色として適用
- `EyelidSprite` (`parts/image/eyelid-sprite.ts`)
  - `eyes[side].open` を 1..6 のフレームに量子化（`0` は一巡アニメ用の予備）
  - 初期版では `emotion` で見た目を変えない（参照実装準拠）
- `MouthSprite` (`parts/image/mouth-sprite.ts`)
  - `mouth.open` を 0..5 のフレームに量子化
  - `theme.primary` を色として適用
- `atlas.ts`
  - `Eyelid` と `Mouth` のフレーム幅・高さ・コマ数を定義
  - `openToFrame(open, maxFrame)` などの純関数を置く

### 6. FaceContext -> variant マッピング
`ImageFace` のパーツは `onFaceContext` でのみ更新する。

```ts
function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v))
}

function openToVariant(open: number, frameCount: number): number {
  return Math.round(clamp01(open) * (frameCount - 1))
}

// mouth-sprite.ts
onFaceContext(content, face) {
  content.variant = openToVariant(face.mouth.open, 6) // 0..5
}

// eyelid-sprite.ts
onFaceContext(content, face) {
  const open = face.eyes[this.side].open
  content.variant = 1 + openToVariant(open, 6) // 1..6
}

// iris-sprite.ts
onFaceContext(content, face) {
  const eye = face.eyes[this.side]
  content.coordinates = {
    left: this.baseLeft + eye.gazeX * 8,
    top: this.baseTop + eye.gazeY * 8,
    width: 16,
    height: 16,
  }
}
```

この方針により、`startSpeech` / `stopSpeech` / `onBlink` の delegate API は `ImageFace` では不要になる。

### 7. 移植ステップ
1. 画像アセットをコピーし、manifest に追加。
2. `parts/image/*` を実装して単体表示確認。
3. `ImageFace` と `renderer-image.ts` を実装。
4. `main.ts` で `renderer.type=image` を有効化。
5. `tests/renderers` に `piu-image` 検証エントリを追加。

### 8. テスト方針
目視確認項目:
- `gazeX/Y` に応じて Iris が移動する。
- `eyes.*.open` の変化で Eyelid フレームが変わる。
- `mouth.open` の変化で Mouth フレームが変わる。
- `simple` / `dog` 既存 renderer が回帰しない。

## Drawbacks
[drawbacks]: #drawbacks

- 画像アセット管理が増える。
- 図形描画より Flash/RAM 使用量が増える可能性がある。
- `moddable-avatar` の時間駆動アニメーションを採用しないため、参照実装と完全一致の見た目にはならない。

## Rationale and alternatives
[rationale-and-alternatives]: #rationale-and-alternatives

- 新規 `image` renderer 追加が最も低リスク。
- 代替1: `SimpleFace` を直接差し替える
  - 既存ユーザーへの影響が大きい。
- 代替2: 参照実装 API をそのまま持ち込む
  - `FaceContext` ベース設計と二重化し、保守性が下がる。
- 代替3: `eyes.png` / `mouth_smile.png` まで同時移植する
  - 初期スコープが広すぎるため段階導入に不向き。

## Prior art
[prior-art]: #prior-art

- `reference/moddable-avatar/src/avatar.ts` の `AvatarEye`, `AvatarEyelid`, `AvatarMouth` 構成。
- 本リポジトリ `renderers-piu` の `FaceBase` / `FaceBehavior` による描画責務分離。

## Unresolved questions
[unresolved-questions]: #unresolved-questions

- `theme.secondary` を Eyelid に常時適用するか、参照実装同様に固定色を残すか。
- 将来 `mouth_smile.png`（80x80）を `emotion=HAPPY` 用として使うか。

## Future possibilities
[future-possibilities]: #future-possibilities

- 画像差し替えだけで顔を増やせる `SpriteFace` 共通基盤へ拡張。
- アトラス定義の JSON 化（フレーム数・オフセットをデータ駆動化）。
- `emotion` ごとの口形状差し替え（`mouth.png` + `mouth_smile.png` 併用）。
