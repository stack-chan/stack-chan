# Piu 描画を軽くするための調査メモ

## 調査対象
- Piu内部実装: `reference/moddable/modules/piu/All/piuContent.c`, `piuContainer.c`, `piuSkin.c`, `piuLabel.c`, `reference/moddable/modules/piu/MC/piuPort.c`, `piuView.c`, `piuRegion.c`, `piuDie.c`, `piuImageBuffer.c`
- Piuドキュメント: `reference/moddable/documentation/piu/piu.md`
- 例 (examples/contributed):
  - `reference/moddable/examples/piu/spiral/main.js`
  - `reference/moddable/examples/piu/list/main.js`
  - `reference/moddable/examples/piu/spinner/main.js`
  - `reference/moddable/examples/piu/heartrate/main.js`
  - `reference/moddable/contributed/ble/hid-peripheral/mod-keyboard/basic-keyboard.js`

---

## 何が重くなりがちか（Piu内部の挙動）

### 1) レイアウト再計算（reflow）を引き起こす操作
Piuの `Content` は座標・サイズ・Skin等の変更で **invalidate + reflow** が走り、親方向へ伝播します。
- `ContentMoveBy` / `ContentSizeBy` は **invalidate + reflow**（`piuContent.c`）
- `ContentSetCoordinates` は **invalidate + reflow**（`piuContent.c`）
- `content.x / y / width / height / size / position` の変更は内部的に同様（`piuContent.c`）
- `content.skin = ...` は **reflow**（`piuContent.c`）
- `Label.string = ...` は **reflow**（`piuLabel.c`）

→ **“毎フレーム座標が変わる”** をやると、レイアウト木全体を巻き込んで重くなりやすい。

### 2) 描画コストが高い要素
- **9-slice / repeat Skin** は描画呼び出しが増える（`piuSkin.c`の `PiuSkinDrawAux` が複数回の draw/fillTexture を行う）
- **Shape/Outline** はベクタ描画（`piuShape.c`）で、毎フレーム更新だと重い
- `Label` は Style 測定・文字描画が絡むため、頻繁更新は重い

### 3) invalidation の粒度と dirty region
- `port.invalidate(x, y, w, h)` は部分更新が可能だが、小領域が多すぎると **dirty region overflow** が起きる（`piuView.c`, `piuRegion.c`）
- overflow 時は “dirty region overflowed” が出て **全画面更新に近い状況**になる

### 4) ノード数が多いほど更新ループが重い
- invalidated area を描画するたびに **コンテナ階層を走査**する（`piuContainer.c`）
- パーツごとに `Content` を作りすぎると、更新コストが増える

---

## 軽量化パターン（examples/contributed から抽出）

### A) Portでまとめ描き + 部分invalidate
- `examples/piu/list/main.js`
  - `Port` 内で `drawLabel / drawContent / drawTexture` を直接呼び出し
  - **1アイテム分だけ invalidate** している
- `examples/piu/spiral/main.js`
  - `port.invalidate(x, y, 1, 1)` のように **最小の更新領域** を指定
- `examples/piu/spinner/main.js`
  - `Port` の `onDraw` で **最小限の fillColor** を繰り返す

→ **多Content構成より、Portで描画を集約**した方が reflow を避けられる

### B) スプライトアトラス + drawTexture
- `examples/piu/heartrate/main.js`
  - 数字を `digits.png` の1枚から `drawTexture` で切り出し
  - `Label` ではなく **Textureベース**で描画

→ 目・まぶた・絵文字などは **スプライト化**が有効

### C) Skin/Style/Texture を再生成しない
- `contributed/ble/hid-peripheral/mod-keyboard/basic-keyboard.js`
  - `Skin.template(Object.freeze(...))`
  - `Texture.template(Object.freeze(...))`
  - `Style.template(Object.freeze(...))`

→ 定数化＆使い回しが前提。**毎フレーム new Skin/Style は避ける**

### D) Die / ImageBuffer の活用
- `piu.md` の `Die` は **更新領域を切り抜く**ための機構（`piuDie.c`）
- `ImageBuffer` は **オフスクリーンに描いて一括転送**可能（`piuImageBuffer.c`）

---

## Stack-chan 顔パーツ向けの具体的な軽量化案

### 1) Breath（上下動）
**現状の重さの原因**
- `content.y` 変更は `invalidate + reflow` が走る（`piuContent.c`）

**軽量化案**
- **Port内で描画位置をずらす**（`onDraw` で `y + offset` を使う）
- もしくは **“顔専用Port”** を作って描画を一元化
- invalidate は **前フレームの顔領域と現在領域のunion** だけ
- `Die` で顔の更新領域を限定し、レイアウトツリー外への波及を抑える

### 2) Blink（まぶた）
**重さの原因**
- `height/top` を毎フレーム変えると reflow
- Shape/Outline なら描画も重い

**軽量化案**
- **まぶたをスプライト化**（open/half/closed を `Texture` の variants に）
- `content.state/variant` で切り替える（state/variant は invalidate のみ）
- Portなら `drawTexture` で **部分切り出し**して見せる

### 3) 目の描画（瞳の移動 / 表情）
**重さの原因**
- 目・瞳を Content 分割して動かすと reflowが多発

**軽量化案**
- 目・瞳を **1枚のTextureアトラス**にまとめ、`drawTexture`で描く
- Portで **左右まとめて描画**し、invalidate を1回にする

### 4) Emoticon（絵文字）
**重さの原因**
- Label/Shape で描画するとコスト高

**軽量化案**
- 絵文字は **スプライト化**して `variant` で切替
- 頻繁に切り替える場合は Label ではなく Port描画

---

## まとめ：重い処理の回避パターン

- **レイアウトを動かさない**（x/y/width/height を毎フレーム変えない）
- **Portへ集約し、描画はonDrawで完結**
- **invalidateは必要最小領域**にする
- **Skin/Style/Textureは事前生成・使い回し**
- **state/variant を使う**（skin差し替えは reflow になる）
- **ベクタ描画よりスプライト化**
- **Die/ImageBuffer で更新領域を限定**

---

## 次に見ると良い場所
- `reference/moddable/examples/piu/list/main.js`（Portでの部分更新）
- `reference/moddable/examples/piu/spiral/main.js`（極小invalidate）
- `reference/moddable/examples/piu/heartrate/main.js`（スプライト描画）
- `reference/moddable/documentation/piu/piu.md` の Die 解説
- `reference/moddable/modules/piu/All/piuContent.c`（どの操作が reflow を呼ぶか）

---

# stackchan/renderers-piu への具体的な差分提案（コード例付き）

## 前提: 現状の重い箇所
- `stackchan/renderers-piu/behaviors/face.ts`
  - `onTimeChanged` で `container.coordinates` を毎フレーム更新 → **reflow が発生**
- `stackchan/renderers-piu/parts/eye.ts`
  - `iris.coordinates` 更新 → **reflow**
  - `Eyelid.updatePath` で `Outline.CanvasPath()` を毎フレーム生成 → **高コスト**
- `stackchan/renderers-piu/parts/mouth.ts`
  - `content.coordinates` 更新 → **reflow**
- `stackchan/renderers-piu/effects/emoticon.ts`
  - `Outline` の生成・変形を毎フレーム → **高コスト**
- `stackchan/renderers-piu/effects/speech-balloon.ts`
  - `label.x` の更新 → **reflow**

---

## 差分提案 1: Breathでコンテナ座標を動かさない
### 変更対象
- `stackchan/renderers-piu/behaviors/face.ts`

### 現状
```ts
const nextY = base.top + this.#current.breath * 6
container.coordinates = {
  ...(container.coordinates ?? {}),
  left: base.left,
  top: nextY,
}
```

### 提案
- **Containerを固定**
- Breathのオフセットは描画側（Port）に反映

### 差分イメージ
```ts
// onTimeChanged
// container.coordinates を更新しない
```

---

## 差分提案 2: Eye / Mouth を Port 化して reflow 回避
### ねらい
- `coordinates` の更新をやめて `invalidate + onDraw` のみで描画
- Blink / Gaze / MouthOpen を Port描画内で反映

### EyePort 例（スプライト方式）
```ts
import { Port, Skin, Texture } from "piu/MC";
import { defaultFaceContext, type FaceContext } from "face-context";

const EYE_W = 24;
const EYE_H = 24;
const IRIS_W = 10;
const IRIS_H = 10;
const EYELID_STEPS = 6; // open→close の段階
const EMOTION_VARIANTS = 5;

const irisTexture = new Texture("iris.png");
const eyelidTexture = new Texture("eyelids.png");

const eyelidSkin = new Skin({
  texture: eyelidTexture,
  width: EYE_W,
  height: EYE_H,
  variants: EMOTION_VARIANTS,
  states: EYELID_STEPS,
});

export type EyePortOptions = {
  cx: number;
  cy: number;
  side: keyof FaceContext["eyes"];
};

function emotionToVariant(emotion: FaceContext["emotion"]): number {
  switch (emotion) {
    case "ANGRY": return 1;
    case "SAD": return 2;
    case "HAPPY": return 3;
    case "SLEEPY": return 4;
    default: return 0;
  }
}

export const EyePort = Port.template((opts: EyePortOptions) => {
  const left = opts.cx - EYE_W / 2;
  const top = opts.cy - EYE_H / 2;
  return {
    left, top, width: EYE_W, height: EYE_H,
    Behavior: class extends Behavior {
      face: FaceContext = defaultFaceContext as FaceContext;
      lastKey = "";

      onFaceContext(port: Port, face: FaceContext) {
        this.face = face;
        const eye = face.eyes[opts.side];
        const key = `${eye.open.toFixed(2)}:${eye.gazeX.toFixed(2)}:${eye.gazeY.toFixed(2)}:${face.emotion}:${face.theme.primary}`;
        if (key !== this.lastKey) {
          this.lastKey = key;
          port.invalidate();
        }
      }

      onDraw(port: Port) {
        const eye = this.face.eyes[opts.side];
        const breathY = Math.round(this.face.breath * 6);
        const gx = Math.round((eye.gazeX ?? 0) * 2);
        const gy = Math.round((eye.gazeY ?? 0) * 2);

        port.drawTexture(
          irisTexture,
          this.face.theme.primary,
          (EYE_W - IRIS_W) / 2 + gx,
          (EYE_H - IRIS_H) / 2 + gy + breathY,
          0, 0, IRIS_W, IRIS_H
        );

        const state = Math.min(EYELID_STEPS - 1, Math.max(0, Math.round((1 - eye.open) * (EYELID_STEPS - 1))));
        const variant = emotionToVariant(this.face.emotion);
        port.drawSkin(eyelidSkin, 0, breathY, EYE_W, EYE_H, variant, state);
      }
    }
  };
});
```

### MouthPort 例（スプライト方式）
```ts
import { Port, Skin, Texture } from "piu/MC";
import { defaultFaceContext, type FaceContext } from "face-context";

const MOUTH_W = 80;
const MOUTH_H = 32;
const MOUTH_STEPS = 6;

const mouthTexture = new Texture("mouth.png");
const mouthSkin = new Skin({
  texture: mouthTexture,
  width: MOUTH_W,
  height: MOUTH_H,
  states: MOUTH_STEPS,
});

export type MouthPortOptions = { cx: number; cy: number; };

export const MouthPort = Port.template((opts: MouthPortOptions) => {
  const left = opts.cx - MOUTH_W / 2;
  const top = opts.cy - MOUTH_H / 2;
  return {
    left, top, width: MOUTH_W, height: MOUTH_H,
    Behavior: class extends Behavior {
      face: FaceContext = defaultFaceContext as FaceContext;
      lastOpen = -1;
      lastPrimary = "";

      onFaceContext(port: Port, face: FaceContext) {
        this.face = face;
        if (face.mouth.open !== this.lastOpen || face.theme.primary !== this.lastPrimary) {
          this.lastOpen = face.mouth.open;
          this.lastPrimary = face.theme.primary;
          port.invalidate();
        }
      }

      onDraw(port: Port) {
        const open = this.face.mouth.open;
        const breathY = Math.round(this.face.breath * 6);
        const state = Math.min(MOUTH_STEPS - 1, Math.max(0, Math.round(open * (MOUTH_STEPS - 1))));
        port.drawSkin(mouthSkin, 0, breathY, MOUTH_W, MOUTH_H, 0, state);
      }
    }
  };
});
```

### Face 定義で置き換え
`stackchan/renderers-piu/behaviors/face.ts`
```ts
import { EyePort } from "parts/eye-port";
import { MouthPort } from "parts/mouth-port";

export const SimpleFace: FaceTemplateCtor = FaceBase.template(($: FaceBaseParams = {}) => {
  const left = $.left ?? 60;
  const top = $.top ?? 60;
  const width = $.width ?? 200;
  const height = $.height ?? 120;
  return {
    left, top, width, height,
    contents: [
      new EyePort({ cx: 30, cy: 33, side: "left" }),
      new EyePort({ cx: 170, cy: 36, side: "right" }),
      new MouthPort({ cx: 100, cy: 88 }),
    ],
  };
});
```

---

## 差分提案 3: Outline のキャッシュ（Port化が難しい場合）
`stackchan/renderers-piu/parts/eye.ts` の `Eyelid.updatePath` を **量子化 + キャッシュ**

```ts
const EYELID_STEPS = 6;
const eyelidCache = new Map<string, OutlineOutline[]>();

function getCachedOutline(side: string, emotion: string, open: number, w: number, h: number) {
  const key = `${side}:${emotion}`;
  let list = eyelidCache.get(key);
  if (!list) {
    list = new Array(EYELID_STEPS);
    eyelidCache.set(key, list);
  }
  const idx = Math.min(EYELID_STEPS - 1, Math.max(0, Math.round((1 - open) * (EYELID_STEPS - 1))));
  if (!list[idx]) {
    const path = new Outline.CanvasPath();
    const closedH = h * (idx / (EYELID_STEPS - 1));
    path.rect(0, 0, w, closedH);
    list[idx] = Outline.fill(path);
  }
  return list[idx];
}
```

---

## 差分提案 4: Emoticon の Outline 描画をスプライト化
`stackchan/renderers-piu/effects/emoticon.ts`
- 現在は `Outline` 生成 + `fillOutline` が頻発
- **スプライト化** or **outlineキャッシュ** で軽量化可能

---

## 差分提案 5: SpeechBalloon の Label.x 更新をやめる
`stackchan/renderers-piu/effects/speech-balloon.ts`
- `label.x` 更新で reflow が発生
- **Port + drawString** へ変更すると軽くなる

---

## 優先順位
1. Breathの座標更新停止
2. Eye/Mouth の Port化
3. Outline キャッシュ化
4. Emoticon / SpeechBalloon の描画方式改善


---

# 追加調査: Face領域の限定（Die/clip）と Skin の継承・state 配列

## 1) Face領域を Die で囲って invalidation を限定する

### 目的
- Face の更新は **Face領域 + breath差分** に閉じ込めたい
- パーツの実装変更なし（Port化なし）で **1箇所の改修で効果を出す**

### 実装方針
- `Die.attach(face)` を使って **既存Faceをそのまま包む**
- `Die.set(...)` で **Face領域 + breath差分** を矩形として定義し、`cut()` で反映
- `Die` は update 時に **current region だけを clip 描画**するため、Face領域外の更新が抑制される

### 参考: Die の挙動（実装）
- `PiuDie_attach` は **既存 content を Die に置換**し、座標を維持したまま子化する
- `PiuDie_set / or / fill` で work region を作り、`cut()` で current region に反映する

（`reference/moddable/modules/piu/MC/piuDie.c`）

### 差分イメージ
#### A. FaceViewBehavior で Die を付与
```ts
import { Die } from "piu/MC";

const FACE_REGION_PAD = 6; // breathの最大振幅に合わせる

class FaceRegionBehavior extends Behavior {
  onDisplaying(die: Die) {
    const pad = FACE_REGION_PAD;
    // Face領域 + breath差分ぶんの矩形
    die.set(0, -pad, die.width, die.height + pad * 2).cut();
  }
}

// FaceViewBehavior.onDisplaying などで
if (this.face && !this.faceRegion) {
  const die = new Die(null, { Behavior: FaceRegionBehavior });
  die.attach(this.face); // faceの親にdieを差し込み、faceを子にする
  this.faceRegion = die;
}
```

#### B. FaceMainTemplate に Die を組み込む
```ts
const FaceRegion = Die.template(($: { pad?: number }) => ({
  left: 0, right: 0, top: 0, bottom: 0,
  Behavior: class extends Behavior {
    onDisplaying(die: Die) {
      const pad = $.pad ?? 6;
      die.set(0, -pad, die.width, die.height + pad * 2).cut();
    }
  },
}));

// FaceMainTemplate で face を FaceRegion に入れる
const faceRegion = new FaceRegion({ pad: 6 });
faceRegion.add(face); // face の left/top を 0 にする場合は要調整
```

### 補足
- `clip: true` は **描画時のクリップ**で、invalidation の範囲自体は減らない
- `Die` は **invalidation → region clip** のため、Face領域外への波及抑止に向く
- `regionLength` が小さすぎると「region overflow」になるので、必要なら `regionLength` を増やす

---

## 2) Skin は継承しない（Style は cascade する）

### 結論
- **Skinは継承しない**（content に明示設定が必要）
- **Styleは cascade する**（doc に明記あり）

### 根拠
- Piu docs では「Styleのcascade」が説明されているが、Skinの継承は説明されていない
- 実装でも `content.style` は cascade 対応、`content.skin` は単純に置換

（`reference/moddable/documentation/piu/piu.md` の “Cascading Styles”）

---

## 3) Skin の fill/stroke は配列で state による切り替えが可能

### 仕様（docs）
- Skin の `fill` / `stroke` は **単色 or 配列(2〜4色)** を指定できる
- `content.state` に応じて **色が選択・ブレンド**される

（`reference/moddable/documentation/piu/piu.md` “Color” セクション）

### 例（examples）
- `reference/moddable/examples/piu/list/main.js`
  ```js
  const itemSkin = new Skin({ fill:[ "#192eab", "black" ] });
  // content.state を変えることで色切替
  ```
- `reference/moddable/examples/piu/sound/main.js`
  ```js
  const buttonSkin = new Skin({ fill: ["#0033cc", "#668cff"] });
  ```

### 実用例（Face theme）
```ts
const facePaletteSkin = new Skin({
  fill: [secondaryColor, primaryColor],
  stroke: [secondaryColor, primaryColor],
});

// primary を使うパーツ
content.skin = facePaletteSkin;
content.state = 1;

// secondary を使うパーツ
content.skin = facePaletteSkin;
content.state = 0;
```

※ Theme 色が変わる場合は Skin 再生成が必要（Skinはimmutable）

---

## まとめ（今回の要望に対する方針）
- **Port化は避ける** → パーツ追加の自由度を優先
- **Face全体をDieで囲う** → breath含めて更新領域を限定
- **Skinは継承しない** → faceで1つ置くだけでは伝播しない
- **state + 色配列で primary/secondary を出し分け可能**


---

# 方針の明記: Eye/Mouth の Port 化は却下

## 理由
- **パーツ実装コストが上がる**（Port描画は「絵を直接描く」責務が必要）
- **サードパーティ拡張性を損なう**（簡易なShape/Contentベースの実装が難しくなる）
- **表現の自由度を維持したい**（既存パーツをそのまま追加・交換できることを優先）

→ そのため **Port化は採用しない**。代わりに **Face領域をDieで囲って更新範囲を限定**し、1箇所の改修で効果を狙う。

---

# Outline キャッシュ化の効果とコスト位置

## 結論
- **Outline.fill / Outline.stroke は「描画」ではなく、Outline（FreeType outlineデータ）を生成**する処理
- **実際の描画（ラスタライズ）は PiuShapeDraw → PocoOutlineFill のタイミングで発生**
- キャッシュで削減できるのは **path構築・outline生成・clone/変形などのコストとGC**
- 描画コストそのもの（PocoOutlineFill のラスタ化）は **毎フレーム残る**

## 根拠
- `commodetto/outline` docs: Outline は FreeType outline データを持つ host object で、`Outline.fill`/`stroke` は outline を生成するだけ
- 描画は Poco の `blendOutline`（Piu側では `PocoOutlineFill`）で行われる

## つまり
- 「Outline.fill の段階で bitmap が生成される」という理解は **違う**
- ただし **Outline.fill は重い**（FreeTypeのアウトライン処理 + メモリ確保）ため、
  - 量子化（例: open を 6段階）
  - outline の再利用/キャッシュ
  が効く


---

# 実装方針（最優先）
- **Eye/MouthのPort化は行わない**（拡張性・実装容易性を優先）
- **FaceをDieで囲って更新領域をFace領域に限定**（breath差分を含める）
- **SkinはFace側でパレット化し、onFaceSkinで配布**（state配列でprimary/secondaryを出し分け）
- Outlineキャッシュは描画コスト優勢のため **優先度低**

# タスクリスト
- [x] FaceをDieでラップし、Face領域＋breath差分をクリップ
- [x] Faceのskinパレットを生成・配布（onFaceSkin）
- [x] Eye/Mouth/Dogパーツをパレット受け取り型に変更（Skin再生成を抑制）
- [x] Face背景のskin更新をパレット優先に変更

