# 近くの端末と姿勢を共有する

`mimic_main` と `mimic_follow` を統合しました。同じ Wi-Fi 上の2台で、DNS-SD の TXT レコードを使って姿勢を共有します。

## 操作

両方を同じ Wi-Fi へ接続し、「姿勢を共有」で片方を「送信」、もう片方を「追従」にします。「向きを変える」で送信側の向きを変えると、追従側へ反映します。停止は同じメニューの「停止」です。

既存の名前 `stackchan` / service type `_http._tcp` / port80 と、TXT の `yaw` / `pitch`（ラジアン）を維持します。SDK の `motion.position` は最後に観測した位置を度で返し、送信時だけ単位を変換します。初回位置がない間は初期値0の広告を使います。100msごとに更新し、追従側では可動域へ制限した最新値を使います。

## 改造と復帰

名前を変更するときは送信側の広告と受信側の名前判定を両方変更します。同名を広告する端末が複数あると競合するため、1組ずつ試してください。見つからなければ Wi-Fi、名前、ローカルネットワークのマルチキャスト対応を確認し、「停止」から再選択します。WASM には DNS-SD の代替実装がありません。

## ビルドと導入

このブランチの app API 2 / host API 7 が必要です。古い host / XSA は更新・再ビルドします。`firmware/` で依存関係とツールチェーンを準備して実行してください。

```sh
npm run mod:build -- mods/examples/pose_sharing/manifest.json
npm run mod -- mods/examples/pose_sharing/manifest.json
```

前者はビルド、後者は既定の CoreS3 への書き込みです。別機種は対応する `mod:stackchan_rt` / `mod:takao_core2_sg90` を使います。機種の宣言と利用できる機能を確認してください。[全例と共通の復帰手順](../README_ja.md)、[公開 SDK](../../../sdk/README_ja.md) に共通契約をまとめています。
