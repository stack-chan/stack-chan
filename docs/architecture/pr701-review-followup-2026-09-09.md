# PR #701のレビュー対応

対象は `codex/firmware-sdk-redesign`。`ce0a6a0` のCI、PRの頭なでイベントの指摘、`bf2d076` に対する外部レビューの終了通知の指摘を確認した。旧APIの撤去状況は [先行監査](retired-api-audit-2026-09-09.md) を維持し、今回は現行SDKの失敗時の動作を修正する。この追加修正のrelease impactはpatch、PR全体のSDK移行はmajor。

## 修正と回帰検査

| 指摘 | 対応 | 検査 |
| --- | --- | --- |
| リアルタイム会話の終了通知がthrowすると音声予約が残る | `onState` の成否にかかわらず `finally` で接続を閉じる。返されたPromiseもエラー監視へ渡し、その完了を解放の条件にしない | XSで実際のAppConversation、ChatService、RuntimeAudioとfake機器を接続。`failed` / `disconnected` × 同期例外 / Promise拒否 / 未完了Promiseの6条件で、workerと予約の解放が1回、エラー報告が1回、次の録音・再生が成功することを確認 |
| フィルターなしの購読で合成された `petting` が落ちる | head touchを購読単位で順番に処理。同時実行を避け、最大8件を待機させる。上限では古い待機イベントを破棄し、解除・アプリ終了で待機列と実行中タスクを取り消す | NodeでRuntimeInputからAppSessionまで接続し、両方向の往復スワイプ、同期・非同期・throwするハンドラー、フィルター、順序、非重複、上限、解除後の抑止を確認 |
| Linux起動確認が完了しない | 待機するログを現在のアプリ起動完了通知 `[main] app ready` に合わせる | 通常起動とSDKミニアプリの起動・操作・終了をLinux simulatorで確認 |
| M5StackChanとブラウザ検証のCIが失敗表示 | ビルド・検証の成功後、成果物アップロードの `FinalizeArtifact` が403になっていた。検査やアップロードを省略せず、修正後のCIで再確認する | [元のBundle run](https://github.com/stack-chan/stack-chan/actions/runs/34251612616)、[元のBuild run](https://github.com/stack-chan/stack-chan/actions/runs/34251612610)。修正コミットに対する結果はPRの対応コメントへSHAとrunのURLを記録する |

公開SDKの型・利用ガイドにも、終了時の解放と頭なでイベントの順序・待機上限を反映した。実際のRuntimeAudioをXSのstrict構成へ組み込むため、初期化とoptional機器の型の絞り込みを明示し、テストmanifestに録音・再生の共通契約を追加した。入力検査では、Timerの型を実際の `repeat()` の戻り値から取得する。

## ローカル検証の再実行

Moddable 9.5.0を設定した環境の `firmware/` で実行する。

```sh
npm run test:unit
npm run check:sdk
npm run check:architecture
npm run check:manifest
npm run check:legacy-names
npm exec -- biome ci . --error-on-warnings
npm run generate-apidoc
npm run test:moddable -- host/app/__tests__/app-conversation host/app/__tests__/context-lifecycle host/modules/input
npm run smoke:lin
npm run smoke:mini-app:lin
```

Nodeは571件、対象XSは4 manifest。Linux起動確認はそれぞれ30秒の生存と期待する起動・操作ログを検査する。全対象のnative release、WASM、Webの視覚検査、成果物の組み立てについては同じPRコミットのCI結果で確認する。

## 安定版の受入との関係

初代M5Stackは容量余裕が小さいため、既存のCI matrixのreleaseビルドとapp partition容量検査を継続する。上限超過を許容せず、最新のサイズとコミットをCI結果とともに確認する。

SDKは引き続きファームウェアに同梱するprivate workspaceである。将来、独立配布を行う場合の受入条件は「リポジトリ外の最小アプリが公開された型・ビルドファイル・手順だけで構築できること」とする。今回、独立パッケージの公開は行わない。

実機の通信・音声・電源断と初学者受入は、CIやfake機器での成功から完了と判断しない。[受入計画](firmware-retirement-plan.md) と [USB調査](m5stackchan-usb-diagnosis-2026-09-09.md) の残件として扱う。旧APIの実行経路を復活させる理由にはしない。
