# 接続の取消しとSDK契約の統合

項目3・5のうち、local peerの非同期操作と接続に属する購読を修正した記録。

## 変更

- LocalPeerErrorと重複したJSON・peer型を撤去し、SDKの型とStackchanErrorに統一。ネットワーク接続失敗のTIMEOUT等をCONFIGへ丸めず、実際のコードを返す。
- BootSessionの独自pending-open管理をTaskScopeへ統合。SDKの取消しをradio取得、探索待ち、確認応答待ち、再送、分割送信まで伝える。開始直後の取消しでも、取得済みradioを閉じる。
- 接続の購読管理をAppConnection.listenへ集約。手動解除と接続終了が重なっても解除は一度だけで、遅れて到着したイベントをアプリへ渡さない。
- local peerの初回announceを呼び出し元の処理が戻ってから開始する。XSで発生したスタック超過を、スタック容量の引き上げで回避せず、処理の境界で解消した。

取消しは既にradioへ渡したフレームを取り消せない。以降のfragmentと再試行を止める。操作の取消し後も生存中のpeer接続は再利用できる。BLE機能間の競合制御はこの変更には含まれない。

## 検証

- Node全551件、SDK strict、構成77件、manifest6対象に成功。
- XS全58 manifestに成功。旧エラーclassだけを検査するmanifestは撤去し、実サービスのXS試験でpreloadされたStackchanErrorの型・コードを確認。
- XSで開始の100回取消し、遅いradio完了、探索タイマーの解除、ACK待ち取消し後の再送停止、分割送信の取消し後に残りを送らないこと、同じ接続での次の送信を確認。
- WASMビルド、CoreS3 / Core2 SG90 / Stackchan RTのreleaseビルドに成功。埋込版は9.5.0+stackchan.9、容量は順に6,686,672 / 3,989,216 / 4,109,872 bytes。
- Chromiumで実WASMの顔・入力教材とboard_diagnosticsを起動・操作し、SDK接続と復旧表示の回帰がないことを確認。

実機での電波・BLE共存・電源断は未検証。設定保存の中断対策、能力判定、無線資源の共通管理、provider統合は続けて実施する。
