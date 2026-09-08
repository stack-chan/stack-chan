# マイクの音量で口を動かす

`streamingAudio(app).monitor()` が返す0〜1の RMS 音量で口を開閉します。マイクの生成や PCM 読み出しはホストで行います。

## 操作と改造

起動時にマイクを開始します。「マイクで口を動かす」をオフにすると入力を止め、口を閉じます。音が小さすぎる・大きすぎる場合は `mod.ts` の口の開きへの換算係数を調整します。値は0〜1へ制限します。

監視中はマイクを占有するため、別の録音や会話開始は `BUSY` になります。監視を止めてから次の入力を開始してください。未搭載マイクや未対応機種は `UNSUPPORTED`、解放に失敗した機器は再使用せず、理由を表示します。その場合は本体を再起動します。WASM の録音教材とは異なり、ライブ音量の橋渡しは未実装です。

## ビルドと導入

このブランチの app API 2 / host API 7 が必要です。古い host / XSA は更新・再ビルドします。`firmware/` で依存関係とツールチェーンを準備して実行してください。

```sh
npm run mod:build -- mods/examples/lip_sync/manifest.json
npm run mod -- mods/examples/lip_sync/manifest.json
```

前者はビルド、後者は既定の CoreS3 への書き込みです。別機種は対応する `mod:stackchan_rt` / `mod:takao_core2_sg90` を使います。機種の宣言と利用できる機能を確認してください。[全例と共通の復帰手順](../README_ja.md)、[公開 SDK](../../../sdk/README_ja.md) に共通契約をまとめています。
