# V1実行経路の撤去（host API 9）

提案の項目2を実装した記録。項目1（Blockly・顔エディター・Gallery生成）は `245803ff5d1423fdddb122ceccba46d87d5649b9` でpush済み。[生成経路の検証記録](blockly-sdk-migration-2026-09-08.md)を参照。

## 撤去と保持する機能

| 撤去した責務 | 残す機能と所有者 |
| --- | --- |
| V1/V2世代分岐、onLaunch/onContextCreated、旧フックの型とresolver | SDK定義だけを読み込む `app-definition` とAppSession |
| raw Contextの名前空間・機器参照・公開型・Drawer registry | SDKとホスト内部の表示専用port。Dockと承認UIも同じ表示経路を使う |
| 旧MotionControllerの周期処理と旧pose操作 | SDKのmotion実行器。物理driverの契約と角度・時間変換は保持 |
| 音声のMaybe/boolean/raw buffer/`useTTS`入口 | PromiseとStackchanError、形式を持つ録音結果、共有入力・出力の所有処理 |
| MODの実行可能な設定、サンプルごとの再生レート設定 | metadataの `settings` データと共通SettingsService。MAUDヘッダーの実レート |
| V1専用のWi-Fi待機・再試行選択画面 | bounded retryを所有するBootSession。SDKアプリはネットワークを必要な時に待つ |
| API 1/schema 1/archive内のmod/config許容 | 全配布経路の共通readerとホスト起動前検査で拒否し、SDKからの再生成を案内 |

新しい互換adapterや別のアプリ実行器は追加していない。機器の停止に必要な内部port、物理資源のowner、保守画面、起動設定、現行のWi-Fi retry、USB EVENTの世代・承認・再送処理は保持する。ホストのmoduleにアクセスできなくするsandbox化とは異なる。

アプリ既定値は共通schemaの `appDefault` が許可した設定に限る。保存済み値が優先され、固定driverはアプリで変更できない。設定用資格情報はアプリ既定値に含めない。無効な設定を持つアプリでも、ホスト設定による復旧表示は使える。詳細な設定schemaの配布側検証と、機種・能力の統一は項目4に残す。

USBアプリは `conversation.remote` を宣言する。ホストは設定完了後、アプリ本体とWi-Fiの初期化より前にUSBの連続bufferを確保し、SDKの `remote()` が論理接続を開く。物理ブリッジと論理接続の寿命を分ける理由は保たれている。

## 検証

- SDK strict、構成77件、6対象のmanifest検査に成功。
- Node全548件、XS全59 manifestに成功。旧MotionController専用manifestを削除し、SDK motionと各物理driverの動作試験を保持。
- XSの実Piu/contextで100回の開始・終了、登録解除、メニュー・顔・入力の復元を確認。実ResourceStreamerで11025/44100 Hz素材の再生開始・完了・解放と不正MAUDの拒否を確認。
- Web237件、React77件、Web/WASMビルドに成功。公開ガイドのSDKコードをstrict型検査で確認。
- Chromiumで4つのGalleryブロックarchive、生成した図形の顔、押下・解放、440 Hz音、置換時の待機・周期処理キャンセルを確認。
- installerを迂回して実WASMに旧APIと未来APIのarchiveを渡しても、本体の評価前検査が拒否。破損したMOD内言語resourceを参照せず復旧を表示。設定画面の再入・戻るを経てから正常なアプリを一度だけ評価。
- Chromiumの録音→再生、tone完了・取消し、再起動、遅い権限許可・decode、view破棄で機器とcontinuationの解放を確認。
- 7教材と5つのSDK例をWASMで操作し、画像アバターの6キャラクターを表示。
- CoreS3 / Takao Core2 SG90 / Stackchan RTのreleaseビルドと埋込版 `9.5.0+stackchan.9` を確認。実機への書き込みは行っていない。

## 続く項目

項目3の責務・寿命・provider統合、項目4の機種・能力・設定schemaの正本と全配布経路への接続、項目5の通信競合・再接続・音声置換・保存中断の検証を継続する。実機の無線共存・電源断と初学者受入は未検証であり、ビルドとシミュレーターで代替した完了宣言はしない。

製品の純減条件も別に測定する。項目1の時点では487ファイル・60,991物理行で、起点 `6eb4623` より68ファイル・8,289行増。サンプルや試験への分類変更、コメント削除、コード圧縮を削減実績に数えない。
