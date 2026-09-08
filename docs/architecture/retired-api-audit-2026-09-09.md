# 旧APIの残存確認と完了条件の更新

2026-09-09の依頼に従い、製品ソースの純減を完了条件から外す。F11は、廃止したアプリAPIの実装・利用者・互換経路が残っていないことを基準とする。明示的な検証、取消し、資源所有に必要なコードは保持する。行数は既存の [計測規則](evidence/firmware-retirement/measure.py) による参考値とし、過去の「純減未達」を現在の残件に数えない。

対象は `firmware/host`、公開SDK・型・manifest・共通契約、7教材と21実行例、およびWebの生成・配布経路。旧APIの名前が消えたことだけでなく、呼び出し元、解決されるモジュール、起動時の拒否と現行APIの動作を確認する。

## 撤去を確認した経路

| 対象 | 確認した状態 |
| --- | --- |
| V1フック・世代別起動・raw Context・旧MotionController | 旧実行器・公開型・名前空間は撤去済み。`defineApp` とAppSessionが残す全アプリを実行する。[先行記録](v1-runtime-retirement-2026-09-08.md) |
| 旧MOD設定・設定別名・旧archiveの許容 | 共通schemaと宣言的settingsに統一。旧API、旧miniapp、実行可能なmod/configは導入・起動前に拒否する |
| 未移行例・旧Blockly生成・参考対話クラス | 7教材・21実行例・既定動作・Web生成は公開SDKを使用。3つの独立した対話クラスとMCPの旧Tool変換は撤去済み |
| Wi-Fiの一括開始・停止・raw service取得 | 利用者のなかった `startNetworkConnection` / `stopNetworkConnection` / `getNetworkConnection` と専用の保持配列を削除。各利用者が `openNetworkConnection` の使用権を閉じる |
| PY32の共有singleton取得API | `getSharedPY32IOExpander` / `tryGetSharedPY32IOExpander` と旧利用者用leaseを削除。取得ごとのleaseに統一し、同じIOを使う別利用者の寿命を保持 |
| 会話の旧設定・独自Tool型 | `ChatType` / `ChatConfig` / `ChatToolSchema` / `ChatTool`、旧config resolver、`parameters ?? inputSchema`、辞書への往復を削除。接続設定とTool schemaはSDK型を使用。workerへ渡す際にだけ通信形式へ変換する |
| タッチの旧read API | `LegacyTouchPoint`、`read()`専用のpolling・タイマーを削除。対応機種のCore2 / CoreS3 / M5StackChan / RT / Takaoが使用するECMA-419 `sample()` に統一。未対応driverは取得した入力を閉じて失敗を返す |
| 吹き出しの無効な旧オプション | 実装で読まれていなかった `space` / `radius` / `speed` を型から削除。表示・余白・配置・tailは現在のオプションで維持 |
| 互換性だけを守る試験・fake | 未使用のWi-Fi fakeと旧PY32 fakeを削除。現行APIの独立した使用権、旧形式の拒否、実際のSDK→ChatServiceの接続を試験する |

この範囲に、廃止したアプリAPIを実行する実装・利用者・互換経路は残っていない。公開依存の構成検査はSDKと各アプリの解決済みimportを比較し、ホスト内部への迂回を拒否する。公開API文書も [SDKの正本から生成](public-sdk-reference-2026-09-09.md) する。

## 同じ語を含む現行機能

XiaoZhi WebSocket v1、MediaPipeのtracking message各版、BLEのlegacy advertisingとMTU対応は、現行SDKから接続する機器・通信相手の形式である。Moddable ChatAudioIO workerの `providerID` / `voiceID` / `modelID` は依存SDKとの境界で必要になる。物理サーボdriverのcallbackと内部のMaybeも、アプリへ公開する操作契約とは別の機器インターフェースとして保持する。

ミニアプリ選択画面の内部callback名 `onLaunch(id)` は、UIで選択したIDを通知する現在の処理であり、旧MODの `onLaunch(context)` を起動するフックではない。旧APIを拒否する診断、拒否を検証するfixture、移行先へ案内するREADMEと日付付き記録も保持する。

## 検証

Moddable 9.5.0、nativeはESP-IDF 6.1、Node 24.19.0を使用。

- 公開SDK strict、firmware Node 569件、構成77件、manifest 7対象が成功。
- XSの全58 manifestを確認。初回に56件成功し、2件はテスト用音声部品のmanifest差し替えと、SDK型を取り込んだことで顕在化した既存fixtureの型指定を修正して再実行に成功した。
- 実際のSDK→ChatServiceとfake物理音声で100回の開始・終了を確認。5 providerの選択、モデル・声・endpoint・Tool schemaの伝達、Tool実行とcall ID、使用権の返却、終了後の状態・文字起こし・Tool呼び出しの抑止を検査した。
- 旧ChatConfigと旧Tool schemaは音声IOを生成する前に拒否。XiaoZhiの接続・認証・音声・MCPとschema制約の維持もXSで確認した。
- Wi-FiとPY32は各利用者が独立して閉じる。別の所有者がいる間の機器維持、最後の所有者による解放、異なるWi-Fi資格情報による横取りの拒否を確認した。
- タッチのpolling・割り込み・遅延通知・開始失敗時の解放、サーボ各driver、Piuの吹き出しと顔表示を確認した。

native release 6対象、WASM、4対象の配布bundleの生成・容量検査が成功した。すべてリポジトリーのnpm wrapperを使用し、実機への書き込みは行っていない。

| release対象 | bytes / app partition | 埋込版 |
| --- | ---: | --- |
| M5Stack | 3,770,960 / 3,801,088 | 9.5.0+stackchan.10.m5 |
| M5Stack Core2 | 3,854,048 / 16,384,000 | 9.5.0+stackchan.10.c2 |
| M5Stack CoreS3 | 3,974,704 / 16,318,464 | 9.5.0+stackchan.10.c3 |
| M5StackChan CoreS3 | 6,555,600 / 16,318,464 | 9.5.0+stackchan.10.sc3 |
| Stackchan RT | 3,974,704 / 16,318,464 | 9.5.0+stackchan.10.rt |
| Takao Core2 SG90 | 3,854,048 / 16,384,000 | 9.5.0+stackchan.10.t2 |

実機の通信・音声・電源断・初学者受入は、このソフトウェア検証では完了扱いにしない。[USB調査](m5stackchan-usb-diagnosis-2026-09-09.md) と [残る資源管理・受入](firmware-retirement-plan.md) を参照する。

## 再実行

`firmware/` から、設定済みのModdable 9.5.0環境で実行する。

```sh
npm run check:sdk
npm run test:unit
npm run check:architecture
npm run check:manifest
npm run test:moddable
```

旧アプリAPIの撤去はmajor変更に含める。今回、公開SDKのapp API 2 / host API 10の契約は変更していない。旧MODはSDKから再生成する。
