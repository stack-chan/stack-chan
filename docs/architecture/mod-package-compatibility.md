# MOD の宣言と配布時の互換性検査

この記録は F10 の実装途中の状態を示す。正本は `stackchan-mod.json`、互換性を読む実装は `firmware/contracts/mod-package.js` と `xsa-metadata.js`。全 MOD の移行、SD・WASM・起動時の検査への接続は継続する。

## 世代を分ける

同じ XS 版でコンパイルできても、MOD が呼ぶホストのサービスが存在するとは限らない。以下を別の情報として扱う。

| 情報                       | 意味                         | 例                                       |
| -------------------------- | ---------------------------- | ---------------------------------------- |
| `schemaVersion`            | `stackchan-mod.json` の形式  | 2                                        |
| `appApiVersion`            | アプリの起動・終了契約       | 1 は旧 hooks、2 は `defineApp` / `setup` |
| `hostApiVersion`           | 必要なホスト API の最小世代  | 2                                        |
| XS の `VERS`               | コンパイル済みコードの XS 版 | 17.8.2                                   |
| Moddable SDK 版            | 本体を作った SDK             | 9.5.0                                    |
| `targets` / `capabilities` | 対象環境と使用機能           | `portable`, `camera`                     |

ホストの API 世代の値を共通契約へ移し、本体の `esp_app_desc` には `9.5.0+stackchan.2` のように記録する。CLI と WebSerial は書き込まれた本体からこの情報を読む。host API 1 と識別された本体へ、host API 2 を要求する MOD は書き込まない。以前の再設計ブランチを利用していた場合も、本体を更新してから教材を書き込む。

検証中、Takao Core2 の通常ビルドには SDK 版ではなく Git のコミット名が記録されていた。CoreS3 だけに適用していた生成を Stack-chan RT / Takao Core2 にも接続し、通常ビルドと bundle が同じ最終 manifest の優先順位を使うようにした。両機種の CLI も SDK 版を確認する。古い Git 名だけの本体は先に更新する。従来の汎用 `run-mcconfig` 経路や全ビルド入口を統合する作業は F7 / F10 に残る。

`schemaVersion: 1` は旧アプリ API 1、最小 host API 1 として解釈する。世代2の要求を schema 1 に追加して隠すことはできない。schema 2 は両方の API 世代を明示する。旧 miniapp の定義は app API 1 として扱い、app API 2 と miniapp の組み合わせは公開契約ができるまで拒否する。

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

ネイティブの `npm run mod:build` / `npm run mod` も、生成後に archive を検査する。manifest の隣に `stackchan-mod.json` がある場合は、archive への同梱と宣言の一致を必須にする。JSON を用意したのに `data` へ追加し忘れた場合や、古い生成物に別の宣言が残った場合に成功を報告しない。

現在の Blockly は旧 hooks を生成するので、Web エディターが作る宣言は schema 2 / app API 1。使用機能は配布前の確認と同じ workspace 解析から得る。SDK 世代2へのコード生成の移行は別の未完了項目であり、metadata の世代を上げるだけで完了とは扱わない。

6つの SDK 教材は schema 2 / app API 2 / host API 2 を同梱する。発話・首振り・撮影の教材は未対応時に案内できるので、その機能を `optionalCapabilities` へ記録する。これは `capabilities` の部分集合であり、将来の起動検査で必須機能と区別する。SDK の主入力は `input.primary`、旧アプリの機種別ボタンは `input.buttons` で、統合した対象環境の能力表への接続は残る。

## 検査の境界

XSA reader はモジュールを実行せずに、atom の境界、版、resource、実行入口を読む。宣言は UTF-8 JSON、最大16KiB。機能や対象のリストは最大32件とし、重複、不正な世代、不明な実行入口、宣言と実際の `mod` / `miniapp` の不一致を拒否する。実行入口の名前は XS の module specifier と比較し、`mod.xsb` を `mod` と同一視しない。

| 経路                            | この段階で接続した検査                                                              | 残る検査                                                           |
| ------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Web ビルド                      | 宣言必須、標準同梱、生成物の宣言・実行入口の一致                                    | 全ソースの SDK 世代2への移行                                       |
| ネイティブビルド                | 生成物の構造と宣言を検査。隣接する宣言があれば同梱・一致を必須化。6教材へ宣言を同梱 | 全既存 MOD / miniapp の宣言と移行                                  |
| CLI 書き込み                    | XSA の構造、宣言、実行入口、実機 host API の要求充足                                | 実際の機種・設定での使用可否                                       |
| WebSerial 書き込み              | 上と同じ host API の検査を、利用者の確認 callback と書き込みより先に実行            | 外部 Gallery 宣言と archive の同一性、実際の機種・設定での使用可否 |
| Gallery                         | schema 1 / 2 の読み取りを共通化                                                     | 全公開 artifact の同梱・再生成・同一性検査                         |
| SD / WASM 保存・起動 / 本体起動 | 今回の変更では未接続                                                                | MOD の import より前の検査と復旧画面、実行時の能力確認             |

`assertModCompatibility` は、渡されたホスト情報だけを検査する。CLI と WebSerial が新たに渡すのは本体の host API 世代。チップ名だけでボードや利用可能な機能を判定したことにはしない。Web の既存プロファイル検査と XS 版・サイズ・書き込み後照合も維持する。

## 旧 MOD の移行期間

新しい Web ビルドは宣言を必須とする。既存 MOD の移行が終わるまでは、CLI / WebSerial の読み取りだけが `allowLegacy: true` を明示し、宣言がない旧 archive のインストールを維持する。この経路では「アプリ API と必要機能を検査できない」とログへ出す。宣言が存在するのに壊れている場合や、将来の schema・未対応世代の場合に、この経路へ戻ることはない。

宣言が欠けた archive のアプリ世代は証明できない。これは互換性保証ではなく、既存教材を一度に利用不能にしないための移行上の例外である。F5 の既存 MOD 分類・移行と配布 artifact の更新後にこの例外を終了し、SD・WASM・起動を含む各経路で必須化する。起動時の import 前検査と全経路での必須化が済むまで、F10 全体を完了としない。

実行時の機能確認は静的な宣言とは別に必要になる。たとえばカメラを要求できる機種でもブラウザーの許可拒否や機器の開始失敗はあり、操作の結果を成功に置き換えない。
