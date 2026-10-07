# Avatar DSL Face MOD (initial prototype)

Release impact: **minor** (`stack-chan`). This opt-in installable feature has a changeset; the standard face remains the default.

Accessory overrides: ID 32 initializes unspecified slots from its mask; explicit IDs 33..40 take precedence. For example, `{ 32: 255, 34: 0 }` disables only slot 1. Both decode and runtime fallback preserve validated `width/height/circular` geometry while discarding tuning and budget overrides.

独立 MOD として stackchan-idf の顔描画 DSL を実行します。ホストの標準 Face・API は変更しません。PC/browser でコンパイルした `.avbc` を MOD resource に同梱し、`robot.ui.setFace(content)` に接続します。エディター import、HTTP/NVS upload はこの段階の対象外です。

## 固定した互換範囲

- Target develop: `876b91ebc475fc05d8e196659c315bebca11bb7c`。
- Reference: [ciniml/stackchan-idf](https://github.com/ciniml/stackchan-idf/tree/419385ef1b875137140085bd50d34dee331f30c2), commit `419385ef1b875137140085bd50d34dee331f30c2`。
- AVDS v1, numeric constants, all pinned opcodes, functions/locals/while, rectangle/circle/triangle, group hints, variables `0x00..0x28`, mouth_form, accessories。
- `default_face.avdsl`、`omega_mouth.avdsl`、`aokko_face.avdsl` と ESM compiler の source は無改変。改行を LF に正規化した SHA-256 は [vendor/PROVENANCE.json](vendor/PROVENANCE.json) に記録しています。
- ユーザー fork `meganetaaan/stackchan-idf` の参照 commit `f2a04dd1c0ffb8a61e9f34588a2fca3bd41f2a90` は mouth_form/accessories がない古い VM です。AVDS の version が同じでも、未知の将来 feature の互換性は保証しません。

実コードの演算を基準にします。各演算の結果を float32 に丸め、`round(-0.5) == -1`、描画座標は int16 範囲内でゼロ方向へ切り捨てます。色は RGB565。`~=` は boolean XOR、emitter の `and/or` は短絡評価で operand value を返します。ユーザー定義関数は void です。

## 使用方法

`firmware/` で、Node と Moddable SDK 9.5.0 の開発環境を用います。

```sh
npm run avatar-dsl:compile
npm run test:avatar-dsl
npm run mod:build -- mods/examples/avatar-dsl/manifest.json
```

最後のコマンドは MOD archive のローカル build のみです。MOD のインストール・実機 flash は別途承認する段階です。生成物は `firmware/dist/` に置かれます。Compiler と source は firmware の実行 bundle に入りません。

`mod.js` は default を選択しています。MOD 内で選択を変えるには:

```js
import { createAvatarFace } from 'avatar-dsl/face'
const face = createAvatarFace({ preset: 'omega' }) // default / omega / aokko
robot.ui.setFace(face.content)
// MOD 側で不要になった時に停止し、参照を解放:
face.dispose()
```

カスタム resource は `manifest.json` に同梱した後、`bytecode: new Resource('custom.avbc')` を渡します。browser では `firmware/tools/avatar-dsl/compiler/compile.js` の `compile(source)` を ESM import できます。compiler は device 上で実行しません。

Runtime import は既存 manifest の `avatar-dsl/...` 名を使います。MOD 内の `package.json` exports は、Node の pure VM/context/driver/opcodes 検証でも同じ名前を解決します。PC 専用 compiler は production-source 走査対象外の `firmware/tools/avatar-dsl/compiler/` に無改変で配置し、実行時 opcode 定義は MOD に保持します。host/CI の規約や manifest alias は変更しません。

MOD-local options は `width/height/circular`、`variables` (AVDS variable ID 12..40)、`mouthForm`、`breathSource: 'state'`、`budget: { instructions, draws }`。既存 host API の拡張ではありません。例: `variables: { 27: 1, 32: 1 }` は cheeks と accessory slot 0 を有効にします。

## 状態と描画の対応

| Target | DSL |
|---|---|
| NEUTRAL / ANGRY / SAD / HAPPY / SLEEPY / DOUBTFUL | 0 / 3 / 2 / 1 / 5 / 4 |
| COLD / HOT / unknown | NEUTRAL fallback |
| primary RGB | primary RGB565 |
| secondary RGB (host 背景色) | background RGB565 |
| MOD accent (既定 yellow) | DSL secondary |
| 左右の open | 小さい方を共通 eye_open に使用、MOD の blink 係数を乗算 |
| 左右の gazeX/Y | 平均を共通 gaze_h/v に使用 |
| mouth.open | mouth_open。mouthForm 未指定・負値は mouth_open |
| 呼吸 | default は 4 秒周期 sin `[-1,1]`。state mode は host breath を `[-1,1]` に制限して直接使用 |
| 時刻 | 表示中かつ motion 有効時の経過 ms を uint32 に wrap して now_ms に配信 |

既存 host には左右別の目と視線がありますが、参照 DSL は共通状態です。この mapping では独立 wink は両目を閉じます。別の saccade は加算しません。上流 breath は文書の範囲説明と異なり実装が `sin[-1,1]` のため実装側に合わせています。

`preservePositionOnSwap=false` / `breathPixels=0` で、ホストの顔原点の引継ぎと二重呼吸移動を避けます。Piu 自身の container timer を使用します。SDK 9.5.0 に `onUndisplaying` callback はなく、native unbind が timer 登録を休止するため、`content.application` で実際の接続状態も確認します。pause/dispose/motion disable、および自身や祖先の非表示でも停止します。復帰時に `lastTime` を更新するため、隠れていた時間は加算しません。直接 `visible` を操作した後の復帰は `behavior.resume(content)` を呼んでください。

Piu Port に存在しない circle/triangle/outline API は使いません。最大 96 個の Shape を固定 pool とし、実際の `Outline.CanvasPath` から rectangle/circle/triangle を描画順に表示します。`begin_group/end_group` は buffered canvas と同じ合成ヒントで、clip や座標移動にはしません。変化時は全 canvas を invalidate します。現段階では dirty region 最適化をしません。Piu の rasterization は上流 LovyanGFX と異なるため pixel 同一は保証しません。

## 安全制限

入力 bytecode は所有コピーを検証します。header/version/reserved/section sizes、numeric finite、opcode/operand、const/context/function/local refs、命令境界上の function/jump target と到達可能な fallthrough を確認します。未知の tag・flags・末尾データは拒否します。上流より厳しい拒否条件です。

Piu へ渡す図形は追加で最大 32 個に制限します。3 presets を全表情 × 101 mouth levels で評価すると、cheeks/accessory 有効時でも最大 26 図形です。ホストの既存 4096-byte display/command lists で試験し、Shape の clip は外側 Container に集約します。VM の draw budget は group を含むため、Piu の図形上限とは別です。

Per frame: 12,000 命令、96 描画/group commands、64 operand slots、256 aggregate locals、16 call frames、16 nested groups。MOD-local budget は最大 50,000 命令／96 commands。座標 int16・色 uint16・finite 結果・負の extent を確認します。無限ループ・再帰・演算エラーは bounded に失敗します。

Frame は VM 成功後にのみ renderer へ渡します。decode/run failure は記録して default preset と safe tuning に切り替えます。失敗した bytecode を再試行しません。`content.behavior.failure` と `renderFailures` を診断に利用できます。描画は固定サイズの command buffer を使用します。

検証済み bytecode は起動時に opcode と operand の固定 TypedArray へ変換し、各フレームの operand decode を省きます。命令予算は元の DSL 命令ごとに数え、stack/locals/call/draw の上限と float32 の丸めを維持します。完全一致の context のみ描画結果を再利用します。比較は時刻を含む全 41 値のビット単位で行い、変更された状態はその場で評価します。

Shape pool、VM storage は固定です。色だけの変更では Outline を再利用し、command buffer の subarray view は作りません。形状変更時の path/Outline と色変更時の Skin は生成します。無割当・実機 30fps は主張しません。同じ診断ホストでの実機 FPS/VM 時間/heap と旧版との画像比較は [VALIDATION.md](VALIDATION.md) に記録しています。

## 検証

```sh
npm run test:avatar-dsl
npm run test:unit
npm run check:architecture
# Linux + SDK 9.5.0 + glib development headers:
npm run test:avatar-dsl:render
# fixture の再生成には pinned upstream checkout + tl_expected submodule + g++:
AVATAR_DSL_UPSTREAM=/path/to/stackchan-idf npm run test:avatar-dsl:oracle
```

Node tests は上流 unmodified C++ `RecordingCanvas` の 192 command sequences と照合します。3 presets × 6 expressions × 8 contexts と 48 numeric cases。破損 header/sections/opcodes/refs/jumps、無限 loop、draw budget、stack/call/locals limits、finite/range、context mapping、timer lifecycle、固定 buffer identity、500 deterministic mutations を含みます。

Piu tests は 36 partial/full framebuffer pairs、3 presets の表情・目・視線・mouth・theme/accessories、Face の detach/reattach/pause/resume/motion disable/dispose と default recovery を確認し、XS VM の CPU 時間と GC 後の heap 使用量を出力します。Piu render runner は既存 jitome runner を再利用します。測定・残課題は [VALIDATION.md](VALIDATION.md) を参照してください。

実機計測 MOD の build は `npm run mod:build -- mods/examples/avatar-dsl/tests/avatar-dsl-device/manifest.json` です。これは build のみで、flash は行いません。計測には `debug`/`instrumentation` を使える診断ホストが必要です。記録した比較条件は driver `none` locked、Wi-Fi manifest skip、head LED null です。3 presets・6 expressions・動的入力・100-frame VM 計測・GC 後 heap・Face lifecycle を順に実行し、最後に default を表示します。通常の `mods/examples/avatar-dsl/manifest.json` が利用用 MOD です。

## ライセンス

Target repository は Apache-2.0。新規 integration/context/driver/tests も Apache-2.0 です。

Vendored compiler、preset sources、`.avbc` と JavaScript VM adaptation は **BSL-1.0** として区別します。元の `SPDX-FileCopyrightText: 2026 Kenta IDA <fuga@fugafuga.org>` と SPDX license header を保持しました。全文は [vendor/LICENSE-BSL-1.0](vendor/LICENSE-BSL-1.0) と移設した PC compiler に隣接する [LICENSE-BSL-1.0](../../../tools/avatar-dsl/LICENSE-BSL-1.0) に同梱しています。Apache として再ライセンスしません。
