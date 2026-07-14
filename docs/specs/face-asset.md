# 顔アセット形式

## 対象

顔アセットは、Stack-chanの起動時に適用する表情、配色、口の開き方を交換するためのデータです。

形式識別子は`tech.stackchan.face`、現在のバージョンは`1`です。

推奨拡張子は`.stackchan-face.json`、MIME型は`application/vnd.stackchan.face+json`です。

機械検証用の定義は[`face-asset.schema.json`](./face-asset.schema.json)にあります。

## フィールド

| フィールド         | 型     | 制約                                                                    |
| ------------------ | ------ | ----------------------------------------------------------------------- |
| `format`           | 文字列 | `tech.stackchan.face`                                                   |
| `version`          | 整数   | `1`                                                                     |
| `name`             | 文字列 | 1文字以上64文字以下                                                     |
| `emotion`          | 文字列 | `NEUTRAL`、`HAPPY`、`ANGRY`、`SAD`、`SLEEPY`、`DOUBTFUL`、`COLD`、`HOT` |
| `colors.primary`   | 文字列 | `#rrggbb`形式                                                           |
| `colors.secondary` | 文字列 | `#rrggbb`形式                                                           |
| `mouth`            | 数値   | 0以上1以下                                                              |

未知のフィールドは、バージョン1では受け付けません。

## MODへの格納

Visual Programmingエディタは、顔アセットを`assets/*.stackchan-face.json`として通常のMOD `resources`へ埋め込みます。

同時に、アセット値から`StackchanContext.face`の呼び出しを生成し、`onContextCreated(robot)`の開始時に適用します。

専用ランタイムや専用ファームウェアは必要ありません。

## ImageAvatarPackとの境界

顔アセットバージョン1は、標準FaceStateの初期値を表します。

画像フレーム、感情ごとの画像対応、まばたきや口パク用スプライトを配布する場合は、ファームウェアの`ImageAvatarPack`登録APIを使用します。

将来、画像パックをこの形式へ統合する場合は、既存バージョン1の意味を変更せず、新しい形式バージョンを追加します。
