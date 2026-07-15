# Visual Programming Phase 4

- Release impact: `minor`
- 対象: Webエディター、統合シミュレーター、CoreS3実機書き込み

ブラウザー上でStack-chanの動作を作成し、プロジェクトと顔アセットを保存し、MODアーカイブへビルドできるVisual Programming機能を追加します。

生成したMODは統合シミュレーターで実行でき、CoreS3では互換性とパーティション容量を検査し、既存MODをバックアップしてから書き込み、復元、削除できます。

ビルドとCIで使用するModdable SDKは8.3.1へ固定し、ブラウザー用ビルドツールと同梱サンプルMODからホスト固有パスを除外します。
