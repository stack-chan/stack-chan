---
"stack-chan": major
"stackchan-web": major
---

MOD 定義の schema 2 にアプリ API 世代、必要な host API 世代、任意の使用機能を追加しました。Web エディターと6つの SDK 教材が標準の Moddable data resource として宣言を同梱します。Web ビルドは生成後にも archive 内の宣言と実行入口を検査します。

すべてのMOD導入経路と本体起動で`stackchan-mod.json`を必須にしました。宣言のない既存XSAはソースから再ビルドが必要です。正しいschema 1の宣言を持つ旧API 1アプリは引き続き読めます。Galleryの取得物と公開宣言の一致も検査します。WebSerialはXS互換範囲とModdable 9.5本体を確認してから書き込みます。

MODの設定と本体を評価する前に互換性を検査し、起動できない場合はホストの設定だけで復旧案内を表示します。SD書き込みはMODを実行しない保守起動から行い、旧アプリのタイマーが動く領域を上書きしません。起動画面と電源ボタンのMOD操作は、一度再起動して書き込み画面に入ります。

全32例へ旧APIの宣言を追加し、Galleryとシミュレーターの配布XSAを更新しました。SDK移行と実機受入は継続中です。同名フォルダー間で古いMODビルド中間物を使う不具合、IndexedDBの中断を保存成功にする経路、起動前に失敗したWASMを終了する際の不正なquitも修正しました。

Stack-chan RT と Takao Core2 の通常ビルドでも SDK 版と host API 世代を記録し、CLI が SDK 版を検査するようにしました。これまで Git のコミット名だけを版として記録していた本体は、MOD を書き込む前に本体の更新が必要です。
