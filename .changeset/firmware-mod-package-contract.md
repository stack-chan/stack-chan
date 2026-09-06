---
"stack-chan": major
"stackchan-web": minor
---

MOD 定義の schema 2 にアプリ API 世代、必要な host API 世代、任意の使用機能を追加しました。Web エディターと6つの SDK 教材が標準の Moddable data resource として宣言を同梱します。Web ビルドは生成後にも archive 内の宣言と実行入口を検査します。

本体の host API 表記を世代2へ更新しました。CLI と WebSerial は MOD の要求を本体の表記と比較し、世代が足りない場合は書き込み前に拒否します。旧 schema 1 は引き続き読めます。情報のない旧 archive は移行期間中のみ検査不能を明示して扱い、壊れた宣言を旧形式として通すことはありません。SD・WASM・起動時の検査と全既存 MOD の移行は継続中です。

Stack-chan RT と Takao Core2 の通常ビルドでも SDK 版と host API 世代を記録し、CLI が SDK 版を検査するようにしました。これまで Git のコミット名だけを版として記録していた本体は、MOD を書き込む前に本体の更新が必要です。
