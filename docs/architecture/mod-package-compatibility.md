# MOD の宣言と配布時の互換性検査

この記録は F10 の実装途中の状態を示す。正本は `stackchan-mod.json`、互換性を読む実装は `firmware/contracts/mod-package.js` と `xsa-metadata.js`。宣言の必須化と SD・WASM・起動時の検査は接続済み。残す全例・Blockly・顔エディターのSDK移行とV1実行経路の撤去は済んだ。実際の機種・設定から得る能力表、実機受入は継続する。

## 世代を分ける

同じ XS 版でコンパイルできても、MOD が呼ぶホストのサービスが存在するとは限らない。以下を別の情報として扱う。

| 情報                       | 意味                         | 例                                       |
| -------------------------- | ---------------------------- | ---------------------------------------- |
| `schemaVersion`            | `stackchan-mod.json` の形式  | 2                                        |
| `appApiVersion`            | アプリの起動・終了契約       | 2 の `defineApp` / `setup` のみ |
| `hostApiVersion`           | 必要なホスト API の最小世代  | 2                                        |
| XS の `VERS`               | コンパイル済みコードの XS 版 | 17.8.2                                   |
| Moddable SDK 版            | 本体を作った SDK             | 9.5.0                                    |
| `targets` / `capabilities` | 対象環境と使用機能           | `portable`, `camera`                     |

ホストの API 世代の値を共通契約へ移し、本体の `esp_app_desc` には `9.5.0+stackchan.9` のように記録する。CLI と WebSerial は書き込まれた本体からこの情報を読む。host API 1 と識別された本体へ、host API 2 を要求する MOD は書き込まない。以前の再設計ブランチを利用していた場合も、本体を更新してから教材を書き込む。

検証中、Takao Core2 の通常ビルドには SDK 版ではなく Git のコミット名が記録されていた。CoreS3 だけに適用していた生成を Stack-chan RT / Takao Core2 にも接続し、通常ビルドと bundle が同じ最終 manifest の優先順位を使うようにした。両機種の CLI も SDK 版を確認する。古い Git 名だけの本体は先に更新する。従来の汎用 `run-mcconfig` 経路や全ビルド入口を統合する作業は F7 / F10 に残る。

host API 9はschema 2 / app API 2だけを受け付ける。schema 1、app API 1、metadataのないarchive、旧 `miniapp` と実行可能な `mod/config` は、コード評価前に拒否する。SDKソースと宣言を更新して再生成するよう案内し、旧フックを読み替えるadapterは残さない。Piu拡張も通常の `mod` と同じAppSessionで起動する。

アプリ既定値は同じmetadataの `settings` に `{"tts.volume": 0.2}` のように宣言する。空でない既定値にはhost API 9が必要。共通archive readerが項目数・型・サイズを検査し、ホストのSettingsServiceが許可された設定キーと値を検証する。保存済み値と機種固定値が優先される。接続資格情報はアプリ既定値へ含めない。設定キーの詳細検証をCLI・Webへ接続する作業は能力表の統一と一緒に残る。

## 標準のビルドで同梱する

`stackchan-mod.json` は Gallery の表示・ソース参照も含む同じ文書を使う。互換性情報だけの別ファイルを管理しない。ネイティブの教材 manifest は、Moddable の標準 `data` 規則で JSON を同梱する。

```json
{
  "modules": { "mod": "./mod" },
  "include": ["$(MODDABLE)/examples/manifest_mod.json"],
  "data": { "*": ["./stackchan-mod.json"] }
}
```

通常の `resources` 規則はローカライズ用以外の JSON をスキップする。`data` は `mcrun` によって XSA の `RSRC` 内へ入る。独自の archive 書き換えや manifest コンパイラーは追加していない。

Web の `buildModArchive` は `metadata` を必須にし、標準 manifest へ `data` を足す。ファイル名の衝突による宣言の差し替えを拒否し、生成後にも archive の宣言と入力の宣言が一致することを確認する。TypeScript/JavaScript のコード内容から API 世代を推測しない。

ネイティブの `npm run mod:build` / `npm run mod` も、生成後に archive を検査する。宣言の同梱を必須にし、manifest の隣の正本と比較する。Galleryのように一階層上へ正本を置く場合は、`source.path` がそのmanifestを指すことを確認して比較する。JSON を用意したのに `data` へ追加し忘れた場合や、古い生成物に別の宣言が残った場合に成功を報告しない。

Blocklyと顔エディターはschema 2 / app API 2 / host API 8のSDKコードを生成する。Gallery 4ブロック例とWASMの配布用starterもSDK化した。入力・周期処理・待機・形状の顔はAppSessionに所属する。

7教材と21個の実行可能な例はapp API 2へ移行した。必要なhost APIと能力は各metadataに宣言し、未対応時に案内して継続できる機能は `optionalCapabilities` に記録する。これは `capabilities` の部分集合である。

## 検査の境界

XSA reader はモジュールを実行せずに、atom の境界、版、resource、実行入口を読む。宣言は UTF-8 JSON、最大16KiB。機能や対象のリストは最大32件とし、重複、不正な世代、不明な実行入口、宣言と実際の `mod` / `miniapp` の不一致を拒否する。実行入口の名前は XS の module specifier と比較し、`mod.xsb` を `mod` と同一視しない。

| 経路 | 接続した検査・動作 | 残る検査 |
| --- | --- | --- |
| Web / ネイティブビルド | 宣言必須、標準同梱、実行入口・外部宣言との一致。21例・7教材・BlocklyをSDKへ移行 | 配布先との能力照合 |
| CLI | 必須宣言・構造・XS版・実機 host API・partition・read-back | 機種と設定に基づく実際の能力 |
| 診断スクリプト | 同じCLIのmodコマンドで検査・書き込み・read-back後、同じportへserial2xsbugを接続。再試行はbridgeだけを再起動 | USBの再起動・実機ログと機器の受入 |
| WebSerial | 必須宣言・構造・XS版・Moddable 9.5・実機 host API。確認callback前に検査 | 機種と設定に基づく実際の能力 |
| Gallery | 全6テキストartifactを標準mcrunで再生成。取得時にid・版・API・対象・機能・実行入口を正本と比較 | 実機受入 |
| SD | 必須宣言・構造・XS版・host API・partition・read-back。保守起動以外からの書き込みを拒否 | 実機の電源断・容量・SDカード受入 |
| WASM保存・読み込み | 必須宣言・構造・XS版・host API・simulator対象。IndexedDBのcommitを待ち、abortを成功扱いしない | 実際のブラウザー能力との照合 |
| 本体起動 | 旧入口・旧archiveを拒否し、`mod`の評価前に必須宣言・host API・実行入口と設定を検査。exportはSDK定義に限定 | 実際の機種・設定から得る能力表 |

`assertModCompatibility` は、渡されたホスト情報だけを検査する。CLI と WebSerial が新たに渡すのは本体の host API 世代。チップ名だけでボードや利用可能な機能を判定したことにはしない。Web の既存プロファイル検査と XS 版・サイズ・書き込み後照合も維持する。

## 旧 MOD の更新と復旧

宣言のない旧XSA、schema 1、app API 1はCLI・WebSerial・SD・WASM・本体起動で拒否する。まずホストをこのブランチのModdable 9.5 / host API 9へ更新し、ソースをSDKへ移し、宣言とmanifestの `data` を加えて再ビルドする。Blocklyは保存したブロックプロジェクトから再生成する。新しく始める場合は [SDK教材](../../firmware/lessons/README_ja.md) の3ファイルをコピーし、最初は `mod.js` だけを編集する。

本体の拒否画面は MOD に依存しないホスト設定で表示言語を決め、エラーコードと MOD 更新の案内を表示する。SD機能のある機種ではMODボタン、再起動のある機種では再起動ボタンを表示する。WASMはWeb側のMOD削除・追加操作を利用する。XSは不正なバイトコードをhost mainより早く拒否する場合もあり、全ての破損archiveをPiu画面で回復できるという保証ではない。

起動入口は小さな`main`と実際のアプリを読み込む`app-main`へ分けた。Moddableの`Resource`もMOD内の同名リソースを優先するため、保守起動と宣言の拒否では、アプリやUIをimportする前にarchiveを切り離す。SDK 9.5の`fxSetArchive`を呼ぶ小さなC adapterが、モジュール・リソースの参照とglobalのarchiveを外す。archiveのマッピングや確保メモリーの所有はプラットフォームに残し、終了時の二重解放を避ける。Moddable更新時にはこのadapterも検証する。試験用MODは不正な同名`locals.mhi`を含み、復旧時にホストの文字リソースを使えることを実WASMで確認する。

SDは、起動画面のMODボタンと電源ボタンのショートカットの両方から、ホスト所有の保守要求を保存して再起動する。次のVMで要求を一度だけ消費し、MODの設定も本体も評価せずに書き込み画面へ入る。実行中のVMが参照するarchive自体を書き換えないため、アプリ終了だけで保守画面へ遷移しない。書き込み成功と「戻る」は再起動する。保守要求はユーザー設定とは別の`stackchan.boot/maintenance`で管理する。任意コードからFlash自体へ触れなくするセキュリティ境界ではない。

既存32例の宣言は [移行台帳](legacy-mod-migration.md) に記録した。ソース移行と機種依存の実機受入は区別する。

## ビルドの再現性

ModdableのMOD出力名は入力の末尾フォルダー名に依存する。Galleryの異なる`mod/manifest.json`を続けてビルドすると、前のCODE・DATAが新しい入力より新しい時刻になり、再利用される場合があった。CLIはMODのbin/tmp生成領域を毎回作り直す。他のMODと本体の生成領域は保持する。生成後の正本との照合も行う。

provider-dialoguesはホスト・XS試験用のnative依存と、MODへ同梱するJSライブラリーのmanifestを分けた。型のためだけに暗号・ネットワーク・MAC取得のCコードをMODへ引き込まない。従来のMaybe型は実装依存のない型ファイルを正本とし、旧utilityから再exportする。face_trackerのTextDecoderもホストから得る。

SDK 9.5のTextDecoder C実装には、WASMで`bool`を宣言するheaderが不足していた。既存WASM wrapperのCコンパイラー指定に`-include stdbool.h`を加え、SDKを直接改変せずに標準デコーダーを使う。

実行時の機能確認は静的な宣言とは別に必要になる。たとえば撮影を要求できる機種でも、ブラウザーの許可拒否や機器の開始失敗を成功へ置き換えない。実際のボード識別、能力・設定・WASMバイナリーの版を一つの正本へ接続する作業は F7 / F9 / F10 に残る。
