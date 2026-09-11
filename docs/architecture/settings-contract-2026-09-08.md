# 設定契約を全配布経路へ接続 — 2026-09-08

残件4の設定schemaを統合した。[機種互換性](target-compatibility-2026-09-08.md) と合わせ、機種・公開能力・設定の正本を本体、SDK、CLI、Web、SD、WASMで共有する。

25キーの型、選択肢、既定値、範囲、整数制約、UTF-8長、秘密情報、適用時点、アプリ既定値の可否を `firmware/contracts/settings-schema.js` に置いた。JSDocを厳密に型検査し、公開SDKの `stackchan/settings-schema` は同じ定義と型を再公開する。内部workspace packageはSDKからの参照に使い、CLIとWebは可搬なファイルを直接読む。生成したschemaや別の設定表は持たない。

共通archive readerが値を検証・正規化するため、CLI・WebSerialは接続前、SD・WASMは既存MODの変更前、本体はMODコードの評価前に不正な宣言を拒否する。loadPreferenceの重複した既定値検査を取り除いた。数値文字列、数値のvoice ID、省略可能欄の空文字は、保存設定と同じ規則で正規化する。保存済み値、アプリ既定値、機種プロファイル、schema既定値の優先順位と機種固定値は維持する。

## 検証

- Node 561件、公開SDK・contractsの厳密な型検査、architecture 77件、manifest 7対象が成功した。キー別の数値型、顔の選択肢、timezoneのliteral型も不正な代入が通らないことを検証した。
- 設定の12種類の不正宣言をCLI、WebSerial、SD、本体起動へ渡し、接続・書き込み・アプリ評価へ進まないことを検証した。廃止キー、Wi-Fi既定値、範囲外、小数ポート、不正な選択肢、UTF-8超過、単独surrogate、NUL、nullを含む。
- XSの全58 manifestが成功した（136.7秒）。設定の読取・復旧・BLE設定画面を含む。WebのNode 240件、React 77件も成功した。
- 最新WASMとWebを再ビルドした。Chromiumでインストーラーを迂回し、音量を0.25から2.25へ改変した実archiveを本体が評価前に拒否した。その後、正しいarchiveへ戻し、設定画面での起動保留とアプリの1回だけの開始を確認した。旧・未来のAPI、不適合な機種・能力の拒否も引き続き成功した。
- Galleryの4 archiveと生成した顔・入力・音声が動作し、置換時に待機・周期処理が終了した。
- 6機種のreleaseビルドと標準4対象のbundle組み立てが成功した。本体の容量とdescriptorは [機種互換性の表](target-compatibility-2026-09-08.md) と同じだった。4MB M5Stackの残容量は5,552 bytesで、今後も検査が必要である。

## 継続する項目

残件3・5の無線競合、provider参照ライブラリー、音声の置換、終了・再接続の境界を継続する。接続機器がないため実機への書き込みは行っていない。無線の同居、実電源断、実機と初学者の受入、および製品ソースの純減は、この記録の完了対象に含めない。
