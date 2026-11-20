# MediaPipe BLE追従 MOD v1.2.1

対象パッケージは`tech.stackchan.samples.mediapipe-ble`です。1.2.1はMODの版番号です。Stack-chan本体の製品版番号は2.0.0のままで、既存のv2.0.0タグを変更しません。

MediaPipe BLE追従の配布アーカイブにCodex Voiceの実行入口が混入していた問題を修正しました。宣言されたMediaPipeソースからクリーンビルドしたアーカイブへ差し替え、取得先を版番号付きのファイル名にしています。

- [安定版GalleryでMediaPipe BLE追従を選択](https://stack-chan.github.io/stack-chan/web/mod-gallery/?mod=tech.stackchan.samples.mediapipe-ble)
- [v1.2.1アーカイブ](https://stack-chan.github.io/stack-chan/web/mod-gallery/samples/mediapipe-ble/mediapipe-ble-v1.2.1.xsa)
- 対応プロファイル: `m5stackchan-cores3`、XS 17.9を受け入れるSDK 10.0系ホスト。対応ホストを使用中なら、MODだけを更新できます。

SDK 10.0.2のクリーン再ビルドと配布物が一致することを確認しています。2026-10-20に実機での受入確認OKの報告を受けています。個別操作や回数の内訳は記録されていないため、全機種・全条件の試験完了とは扱いません。

共通ビルドの同名ディレクトリによるキャッシュ共有は、この配布修正では解消していません。再生成時はパッケージごとにクリーンビルドしてください。

## English

MediaPipe BLE MOD **1.2.1** replaces the archive that contained the Codex Voice entry module with a clean build of the declared MediaPipe source. The versioned download path avoids reusing the old artifact.

This is a MOD-only stable Gallery update. The Stack-chan product version remains 2.0.0, and the existing v2.0.0 tag is unchanged. A compatible SDK 10.0 host accepting XS 17.9 archives is required.

A clean SDK 10.0.2 rebuild matches the replacement archive. Operator acceptance was reported on 2026-10-20 without an itemized device test matrix. The shared build-cache issue still requires clean builds per package.
