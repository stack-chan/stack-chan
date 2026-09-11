# サーボUARTの所有と操作契約

この実装は F2（寿命）と F4（物理UARTの競合）の一部を扱う。SCServo、DYNAMIXEL、RS30Xの各インスタンスが持っていた応答待ちと待ち行列を、UARTを所有する一つの `ServoBus` に移した。V2のmotionサービス、到達判定、注視との調停、設定画面からの復旧は引き続き別の作業である。

```mermaid
flowchart LR
  H[Hostの資源スコープ] --> D[MotionDriver]
  D --> P[panのEndpoint]
  D --> T[tiltのEndpoint]
  P --> B[UARTごとのServoBus]
  T --> B
  B --> Q[上限と期限のあるFIFO]
  Q --> S[Serialとプロトコルの受信処理]
```

| 境界 | 契約 |
| --- | --- |
| 取得 | UART番号を正本とし、ピン・baud・プロトコルが異なる共有を `CONFIG`、同じIDの二重所有を `BUSY` とする。検査前に別のSerialを開かない |
| 待機 | 待機8件まで、待機期限5秒。満杯は `BUSY`、未送信で期限を超えた要求は `TIMEOUT`。未送信の失敗で通信中の要求を停止しない |
| 送受信 | UART全体で一件ずつ送信し、送信前に応答期限を登録する。SCServoは120ms、RS30Xは100ms、DYNAMIXELは既定200ms。DYNAMIXELの設定値は1〜60000msの整数に限定する |
| 完了 | 応答を受信してもSerialのコールバック内では利用者のコードを呼ばない。Timerで呼び出し元のスタックが戻ってから一度だけ通知する |
| 応答なしの書き込み | UARTへの送信受付を通知する。baudとパケット長から見積もった送信時間を空けて次へ進む。この通知はサーボの指令受理・移動完了の保証ではない |
| 終了 | `close()` は同期・終端・冪等。待機中と通知前の操作を失敗として完了し、全ID予約を解放する。`teardown()` も同じ処理へ接続する |
| 共有資源 | 最後のEndpointが閉じたときだけSerialを閉じる。物理closeが失敗したUARTは予約を残し、別インスタンスでの再取得を禁止する |
| 構築失敗 | 各2軸ドライバーがサーボ取得直後に所有を登録する。2軸目以降の失敗では逆順に解放し、初期化の元のエラーを保持する |

`ServoBusRegistry` 自体も実行時に初めて生成する。XSでpreloadしたMapはROM上の読み取り専用オブジェクトになるため、モジュール読み込み時に可変な資源台帳を作る方式は採用しない。この制約は実際のXS試験で検出した。

タイムアウトと復旧の扱いは従来から変更した。DYNAMIXELの応答にはID・status・データ・CRCがあり、操作ごとの通し番号はない。この構造から、任意に遅れた同一IDへの応答を次の要求と確実に区別することはできないと判断した。20ms空けて次を送る従来処理を、応答の識別保証として扱わない。[ROBOTIS Protocol 2.0のパケット構造](https://emanual.robotis.com/docs/en/dxl/protocol2/#status-packet)

本実装では、送信後のタイムアウト・送信失敗・応答待ち中のEndpoint終了をUART全体の停止状態にする。待機中の操作も失敗として完了させ、そのUARTへ追加送信しない。DYNAMIXELの制御ループもエラーを成功に置き換えず停止し、初期化失敗や通信エラー後に有効な位置サンプルを装わない。

復旧は、共有している全サーボを閉じて通信オブジェクトを再生成する境界で行う。片軸だけの再生成や、所有者がいる状態の `Dynamixel.setBaud()` によるSerialの差し替えは認めない。再生成は古いJavaScriptコールバックを切り離すが、実サーボが既に実行した移動、EEPROMへの書き込み、ワイヤ上の任意に遅い応答を取り消すものではない。診断時は実機の状態とID・baudを確認する必要がある。通信停止状態からの案内と再初期化操作は、V2のmotionサービスと診断へ接続する。

ID変更は通常操作と分けて扱う。対象Endpointに未完了の要求がないことを確認し、変更先IDを先に予約する。変更中は対象サーボへの通常要求を `BUSY` とする。ID書き込みの応答は旧ID・新IDのどちらでも受け、成功後に次の指令の宛先を更新する。SCServoのunlock / ID write / lock、DYNAMIXELのtorque off / ID write、RS30XのID write / flashを、それぞれこの予約内で実行する。終了時には途中の予約も解放する。

受信処理は固定64-byteバッファを維持し、バッファを超える長さや成立しない短いフレームを破棄する。DYNAMIXELはCRCを検証してからbyte stuffingを除去し、送信時はstuffing後に長さとCRCを計算する。WRITEに対するエラーstatusを成功扱いせず、CRCの2バイトが応答データへ紛れ込まないよう修正した。factory resetは、文書化していたID・baud保持の選択値に合わせた。[ROBOTISの送受信手順](https://emanual.robotis.com/docs/en/dxl/protocol2/#packet-process), [Factory Reset](https://emanual.robotis.com/docs/en/dxl/protocol2/#factory-reset-0x06)

| 検証 | 観測する内容 |
| --- | --- |
| Node `servo-bus.test.ts` | 100回の共有UART生成・終了、FIFO、異なるIDの応答、待機上限・期限、送信期限、同期応答、再入close、送信・物理close・Timer生成の失敗、古いtransportのcallback、ID予約 |
| XS `servo-protocol-lifecycle` | 実プロトコル＋Timerと偽Serialで、各プロトコル100回の2軸生成・通信・終了、ID変更途中の終了、受信分割、echo、破損・過大パケット、byte stuffing、負角度、ドライバー構築失敗を検証 |
| 既存検査 | SDKと教材の型、依存境界、6機種のmanifest、全XS、Node、Biomeを継続 |

旧 `SingleWaitSlot` とそれに対応するテストは削除した。プロトコルのソースに特定の文字列があることを要求していた構成テストも、実送受信を観測するXS試験へ置き換えた。

リリース影響は、SDK全体の再設計に合わせて **major** として扱う。特にUARTのタイムアウト後に自動で再送しなくなる点、`setBaud()` の使用条件、実サーボへの電源供給直後の応答時間は実機受入が必要である。コンパイルと偽Serialによる成功を、電気的な通信・電源・可動域の確認とは見なさない。共有PY32 expanderの寿命、全プロトコルの入力単位・可動域、V2の取消し・到達契約も未完了である。
