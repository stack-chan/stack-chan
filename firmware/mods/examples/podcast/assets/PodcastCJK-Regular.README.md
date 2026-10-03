# PodcastCJK-Regular.ttf

Noto Sans CJK SC 2.004 Regular の Podcast UI 用サブセットです。印刷可能な ASCII、選択印（●）、`../strings/{ja,en,zh-CN}.json` の表示文字を収録しています。ビルド時は必要な字形を 12 px のビットマップに変換します。

ビットマップ化には `PodcastCJK-chars.txt` の文字一覧を使用します。SDK の MOD ビルドではフォントの `localization: true` がホスト用の `locals.mhi` を参照するため、MOD 用の `modLocals` に依存しない文字一覧を指定しています。翻訳に文字を追加する時は TTF と文字一覧も更新します。テストで両方の字形範囲を確認します。

- Source: <https://github.com/notofonts/noto-cjk/blob/Sans2.004/Sans/Variable/TTF/Subset/NotoSansSC-VF.ttf>
- Source SHA-256: `d68bafcb48a2707749396aa12bbbd833cb70401f3a9a689fd2902c7e0d295964`
- Transformation: fontTools で `wght=400` に固定し、上記文字に subset
- Copyright: © 2014-2021 Adobe, Reserved Font Name “Source”
- License: SIL Open Font License 1.1（`PodcastCJK-Regular.LICENSE.txt`）

RSS の番組名・エピソード名は翻訳しません。このフォントは任意の中国語タイトルの全字形を収録していません。
