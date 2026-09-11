# 機種識別と配布前検査の統合 — 2026-09-08

残件4の機種定義と配布経路を接続した記録。公開能力名と起動前の実状態検査は [能力契約の記録](capability-contract-2026-09-08.md)、利用者向けの互換性規則は [MODの宣言](mod-package-compatibility.md) を参照する。

`firmware/contracts/targets.js` を機種ID、descriptorコード、ビルド名、platform、manifest、bundle ID、実装可能な能力の正本にした。CLI・bundle・Webの重複表を削除した。共通の生成処理が本体の `esp_app_desc.version` と `mc/config.stackchanTarget` を設定する。ESP descriptor・partition・XS版のreaderもcontractsへまとめ、CLIからWeb内部への依存を解消した。

WebSerialとCLIは本体のdescriptor、SDと起動時は本体の構成、WASMはsimulatorプロファイルを使って、同じ対象機種・必須能力の検査を行う。保存済みMODを消す前、および起動時にMODコードを評価する前に拒否する。機種IDのない旧本体をチップ名や利用者の選択から推測しない。対象機種を指定するインストールには本体更新を案内し、MOD削除は復旧のため引き続き利用できる。

能力表はビルドが実装できる機能の上限である。接続済み機器、設定、権限、利用中の資源は起動時と実行時に確認する。descriptorが保証するのはビルド対象であり、物理ボードそのものの検出ではない。

## 検証

- Node単体559件、SDKとcontractsの厳密な型検査、architecture 77件、manifest 7対象が成功した。
- XSの全58 manifestがクリーンな生成物から成功した（333.4秒）。機種不一致・旧本体・必須能力不足の起動前拒否と、任意能力を許容する関係を含む。
- WebのNode 239件、React 77件が成功した。CLIとWebSerialは不適合時に書き込みが発生しないことを検証し、SDは旧データを保持することを検証した。
- 最新WASMをWebへ再ビルドしてChromiumで検証した。対象機種を改変したarchive、旧・未来のAPI、未対応の必須無線能力を拒否した後に正常MODへ復旧できた。Galleryの4種と生成した顔・入力・音声が動作し、置換時の待機・周期処理が止まった。教材01-face・03-inputとboard_diagnosticsも実行した。
- `node scripts/update-body-font.mjs --check` が成功した。全localeのCJK表示も373 codepointへ更新した。
- 下記6機種のreleaseを実ビルドし、descriptorと実際のpartition容量を照合した。標準4対象のbundleを `npm run bundle:package` で組み立てた。

| 機種 | descriptor | 本体bytes / factory partition bytes |
| --- | --- | ---: |
| M5Stack | `9.5.0+stackchan.9.m5` | 3,795,536 / 3,801,088 |
| M5Stack Core2 | `9.5.0+stackchan.9.c2` | 3,882,720 / 16,384,000 |
| M5Stack CoreS3 | `9.5.0+stackchan.9.c3` | 4,003,376 / 16,318,464 |
| M5StackChan CoreS3 | `9.5.0+stackchan.9.sc3` | 6,580,176 / 16,318,464 |
| Stack-chan RT | `9.5.0+stackchan.9.rt` | 4,003,376 / 16,318,464 |
| Takao Core2 SG90 | `9.5.0+stackchan.9.t2` | 3,878,624 / 16,384,000 |

ビルド中、ESP-IDFの容量検査が失敗してもmcconfigが終了値0を返すケースを確認した。通常のbuild・flash・deploy・debugも、まず書き込みなしでビルドし、bundleと同じ生成物検査を通してから後続処理へ進む。ツールが成功を返しても容量超過を検出し、flash・deploy・debugへ進まないテストを追加した。

## 4MB M5Stackの容量

12px本文フォントを、同じ字形・文字集合・メトリクスのBMFontと1bit atlasで格納した。Moddableの既存 `*-alpha-monochrome` 変換を使い、SDKや生成Makefileは変更していない。元のフォント、全日本語文字集合、ASCII、3言語のcatalogから再生成できる。

生成したFNTとPNGは、以前のfontbm中間生成物とbyte単位で一致する。格納時の389,735 bytesのBF4を、143,472 bytesのFNTと131,080 bytesの1bit bitmapへ置き換えた。文字や機能の削除は行っていない。再生成方法とSDK 9.5の変換規則については [フォントの記録](../../firmware/host/modules/ui/assets/fonts/k8x12-12.README.md) を参照する。

M5Stackの残容量は **5,552 bytes** であり余裕は小さい。ホストを増やす変更は、この機種の実ビルドによる容量検査を継続し、重複実装の削減も進める。

## 継続する項目

設定schemaの値とアプリ既定値の許可規則をCLI・Webにも接続する。無線の競合制御、provider参照ライブラリー、音声の置換・再接続と終了処理は残件3・5として継続する。

この検証環境にはUSBシリアル機器がなく、実機への書き込みは行っていない。無線同居、実電源断、実機の音声・操作、初学者受入は未検証である。全体の完了や製品ソースの純減を示す記録ではない。

設定schemaの配布側検証は、その後 [設定契約の統合](settings-contract-2026-09-08.md) で接続した。
