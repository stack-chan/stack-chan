- Feature Name: `speech_balloon_chat_rendering`
- Start Date: 2026-02-04
- RFC PR: (TBD)
- Related Issue: (N/A)
- Target: Moddable SDK + TypeScript

## Summary
[summary]: #summary

画面下端に2行固定のMultiRowBalloon（新規）を描画し、k8x12日本語フォントでチャット文字列を等幅8px単位で折り返し、2行を超えた分は「1行目削除→2行目を1行目にシフト→新規行描画」で更新する描画仕様を定義します。音声認識結果と音声合成の描画は同じバルーンを再利用し、ChatService の state 変化によるターン切り替わり時にバルーンをクリアします。既存のmarquee版SpeechBalloonは残し、用途で使い分けます。

## Motivation
[motivation]: #motivation

現状のチャット表示はスクロールや行数の扱いが不明確で、UIの一貫性や可読性が下がる問題があります。固定2行のMultiRowBalloonを常時描画し、等幅フォントに合わせた単純な折り返しと行シフトのルールを明示することで、低コストで安定した表示を実現できます。また、音声認識と音声合成で同じバルーンを共有し、ChatService の state 変化に合わせてクリアすることで、視認性と会話の区切りが明確になります。既存のmarquee版SpeechBalloonは置き換えず残すため、用途に応じた選択ができます。

具体的な利用例:
- 会話ログの最新2行のみを常に見せたい場合。
- 小さな画面（例: 240x240）でもUIを崩さず表示したい場合。
- 文字幅が固定のフォント（k8x12）を前提に、計算コストを極小化したい場合。

## Guide-level explanation
[guide-level-explanation]: #guide-level-explanation

この機能は「画面下端の2行バルーンにチャットを出すためのルール」を提供します。利用者は、1文字ずつ追加されていくチャット文字列を渡すだけで、MultiRowBalloonが常に最新2行を表示します。既存のmarquee版SpeechBalloonは別用途に残し、チャット表示はMultiRowBalloonを使います。

概念:
- SpeechBalloon: 画面下端に固定表示される吹き出し枠
- 行バッファ: 2行分のテキストを保持する配列

使い方の流れ（イメージ）:
1. 初期化時にMultiRowBalloonを描画（枠 + 空行）
2. 音声認識中/音声合成中のどちらも同一バルーンを使う
3. 文字が追加されるたびに、現在行に追加
4. 行が幅いっぱいになったら次の行へ
5. 2行目が埋まった後に新規文字が来たら、
   - 1行目を捨てる
   - 2行目を1行目にシフト
   - 新しい2行目を空にして描画
6. ChatService の state 変化でターンが切り替わるタイミングでバルーンをクリアする

この結果、ユーザーはスクロール操作なしで「最新の会話だけ」を安定して見られ、音声認識と音声合成の区切りも明確になります。既存のチャット表示ロジックを大きく変更せずに導入できます。

## Reference-level explanation
[reference-level-explanation]: #reference-level-explanation

### 仕様
- フォント: k8x12
- 文字幅: 8px固定
- 文字高さ: 12px固定
- 画面サイズ: M5Stack CoreS3 (320x240)
- バルーン位置:
  - 画面下端から `bottom = 4px`
  - 高さは `24px (2行分) + 4px` とし、合計 28px
- 横幅:
  - 画面全幅で固定（左右マージンを含む場合は実装で調整）
- バルーン内テキスト領域:
  - 高さ 24px（12px x 2行）
  - 上下パディング合計 4px（推奨: top 2px, bottom 2px）
- テキスト領域の横幅:
  - `display_width - left_padding - right_padding`
  - 推奨 padding: 左右 4px（境界線含む場合は要調整）
- 折り返し:
  - `max_cols = floor(text_area_width / 8)`
  - 文字数が max_cols に達したら次行へ
- 行更新:
  - `line1` と `line2` の2行を保持
  - `line2` が埋まった状態で新規文字が来たら
    - `line1 = line2`
    - `line2 = ""`
    - 新規文字を `line2` へ
- ターン切り替え:
  - 音声認識フェーズと音声合成フェーズで同一バルーンを使う
  - ターンは ChatService の state 変化（LISTENING ↔ SPEAKING）を指す
  - 切り替わり時に `line1 = ""`, `line2 = ""` にして再描画

### 描画手順（擬似コード）
```text
const line_height = 12
const char_width = 8
const balloon_height = 28
const bottom_margin = 4
const padding_y = 2
const padding_x = 4

balloon_top = display_height - bottom_margin - balloon_height
text_top = balloon_top + padding_y
text_left = padding_x
text_area_width = display_width - (padding_x * 2)

max_cols = floor(text_area_width / char_width)

on_char_input(ch):
  if line2.length == max_cols:
     line1 = line2
     line2 = ""
  if line1.length == max_cols and line2.length == 0:
     // 1行目が埋まって次行に移るタイミング
  if line1.length < max_cols and line2.length == 0:
     line1 += ch
  else:
     line2 += ch
  redraw_balloon()

on_turn_change(): // ChatService state changed
  line1 = ""
  line2 = ""
  redraw_balloon()

redraw_balloon():
  clear_rect(balloon_top, balloon_height)
  draw_balloon_frame(balloon_top, balloon_height)
  draw_text(line1, text_left, text_top)
  draw_text(line2, text_left, text_top + line_height)
```

### 描画の注意点
- 毎フレーム全画面をクリアせず、バルーン領域のみ再描画する。
- 日本語文字は全角1文字＝8px前提（k8x12の等幅仕様に依存）。
- 1文字追加ごとに再描画しても負荷が高い場合は、バッファリングして一定間隔で描画する。

## Drawbacks
[drawbacks]: #drawbacks

- 表示できる情報が常に2行に限定される。
- 固定幅フォントを前提にしているため、可変幅フォントには向かない。
- 1文字単位の描画更新が多いと描画負荷が増える可能性がある。

## Rationale and alternatives
[rationale-and-alternatives]: #rationale-and-alternatives

- 2行固定は画面サイズに依らず安定したUIを提供できる。
- 文字単位の折り返しは計算が単純で、組み込み環境向き。
- 代替案:
  - 単語単位で折り返し: 日本語では空白区切りがないため複雑。
  - スクロール式ログ表示: 描画負荷とUIの複雑性が増す。
- 実装をライブラリ化する案もあるが、現状はUI仕様として明文化するほうが効果が大きい。

## Prior art
[prior-art]: #prior-art

- 組み込みUIでの固定行数チャット表示は一般的（小型LCD・IoT端末の通知UIなど）。
- 2行固定の会話表示は、低解像度端末やレトロUIでも広く採用されている。

## Unresolved questions
[unresolved-questions]: #unresolved-questions

- 画面解像度や左右パディングのデフォルト値をどう決めるか。
- k8x12以外のフォントに対応する必要があるか。
- 描画更新頻度（文字単位 vs フレーム単位）の最適化方針。

## Future possibilities
[future-possibilities]: #future-possibilities

- 3行以上への拡張と簡易スクロール対応。
- 文字出現アニメーション（タイプライタ風）。
- バルーン形状（角丸・尻尾など）のバリエーション追加。
- 画面サイズに応じた自動レイアウト調整。
