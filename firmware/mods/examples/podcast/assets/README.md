# Podcast UI のフォント

中国語 UI はホストの `StackchanCJK-Regular.ttf` を再利用してビルドします。出典とライセンスは [共有フォントの説明](../../../../host/modules/ui/assets/fonts/StackchanCJK-Regular.README.md)を参照してください。

MOD に収録する `PodcastCJK-12` のビットマップ化には `PodcastCJK-chars.txt` を使用します。SDK の MOD ビルドではフォントの `localization: true` がホスト用の `locals.mhi` を参照するため、MOD 用の `modLocals` に依存しない文字一覧を指定しています。翻訳に文字を追加する時は共有 TTF と文字一覧の両方の字形範囲を確認します。テストで両方を検証します。

RSS の番組名・エピソード名は翻訳しません。このフォントは任意の中国語タイトルの全字形を収録していません。
