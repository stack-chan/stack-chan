# 顔 DSL エディタ（未リリース）

Release impact: minor

Web tools に顔 DSL エディタを追加。実機と共通の C/WASM プレビュー、プリセット、検証、DSL/AVBC 保存と Web Serial 経由の顔 MOD 転送に対応します。C SENSOR プリセットは実機の瞬きと呼吸に追従します。

WebMCP 対応ブラウザではガイド・サンプル取得、revision を照合した編集、undo と転送確認の準備を利用できます。書込みにはページ上の確認と USB ポート選択が必要です。未対応ブラウザでは通常操作を利用できます。

対応する native Avatar DSL host が必要です。実機への書込み検証は今回の変更に含めていません。
