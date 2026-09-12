# SDK再設計をmilestoneへ1本ずつ取り込む

SDK再設計は`milestone/sdk-redesign`で統合し、各PRのレビューと取り込みを終えてから次へ進めます。
この手順は実装者とレビュアー向けです。[公開契約](../specs/firmware-sdk-app-contract.md)と併せて、担当する段階の受入条件を確認してください。

## 準備PRからmilestoneへ取り込む

Moddable 9.5への移行は[PR #692](https://github.com/stack-chan/stack-chan/pull/692)で先行し、developへ`cf3dde86b0be0f0496b82d6629cb296220df26b1`として取り込みました。
このコミットから`milestone/sdk-redesign`を作成し、設計文書とmilestone向けCIを含む[準備PR #705](https://github.com/stack-chan/stack-chan/pull/705)を最初に取り込みます。
#705を含む再設計の各PRはmilestoneへ向け、全段階の検証を終えた統合PRでdevelopへ戻します。

BuildとBundleのワークフローはmilestoneのpushと、それを取り込み先にするPRを対象にします。
CodeRabbitの自動レビュー対象にも、このmilestoneを追加します。
Cloudflareの自動配布は、既定ブランチdevelopの対象判定がmilestoneを許可しないためスキップされます。
milestone期間中はBundleの`cloudflare-pages-preview`成果物を取得し、[ローカルでプレビューを確認](./cloudflare-pr-preview_ja.md#milestoneのプレビューをローカルで確認する)します。
GitHub Pagesの更新対象はdevelopとmainのままです。

## 一つのPRを取り込んでから次の作業を始める

1. 最新milestoneとdevelopを確認する。developに更新があれば同期PRを先にレビューし、milestoneへ取り込む。
2. 最新milestoneから、その段階の作業ブランチを作成する。
3. 実装、公開API、事前検査、関連する教材・サンプル・資料、テストを一つのPRへまとめる。
4. PRをmilestoneへ向け、レビュー承認、必須CI、必要な実機確認を揃える。
5. milestoneへ取り込んだ後、レビュー結果を次の段階へ反映して次の作業ブランチを作成する。

後続の依存ブランチやdraft PRは先に作りません。
共有後のmilestoneをrebaseやforce-pushで書き換えず、developとの同期にはmerge commitを使います。
途中で不具合が見つかった場合は、次の機能追加より先に修正PRを取り込みます。

[PR #701](https://github.com/stack-chan/stack-chan/pull/701)は差分と調査結果の参照元として保全します。
その時点のdevelopに取り込まれた修正を確認し、必要な変更だけを取り出します。
既存機能を動かしながら新APIを追加し、新旧の入口を同じサービス実装へ接続します。

## 共通Appを早期にレビューする

各行を一つのPRとして扱います。
準備PR #705では、milestone向けPRでCIが起動し、プレビュー成果物を取得して開けることも取り込み条件にします。

| 順 | 変更 | 取り込み前に確認する状態 |
| --- | --- | --- |
| 1 | metadata・capability台帳・事前検査 | CLI／Webで契約情報を生成し、導入・起動前に検査する。旧形式を読める |
| 2 | 共通Appモデルと最小SDK | face・UI・input・timeを接続し、顔＋ゲーム2個で遷移・戻る・常駐処理の継続を確認する |
| 3 | 音声の共有とapp.audio | TTS・効果音・Realtime・WebRadio・USBが出力を共有し、会話中の効果音と系統ごとの停止が動く |
| 4 | motionの所有・到達判定とapp.motion | ドライバー別許容値、measured／estimated、停止、視線復帰が動く |
| 5 | カメラ・照明・センサー | app.camera／lighting／sensorsが所有者終了時に機器と購読を解放する |
| 6 | 設定サービスとapp.settings | schema、既定値、保存・復旧を共有し、新旧APIから同じ設定を扱える |
| 7 | 通信サービスとapp.network | HTTP・ローカル通信・BLE・MCPの接続、購読、失敗、終了後の通知を処理する |
| 8 | 会話サービスとapp.conversation | テキスト／Realtime会話とToolを接続し、Toolからtone／playClipを鳴らして会話を継続する |
| 9 | 既定動作の共通MOD／App化 | MOD未導入時の顔＋DrawerMenu、設定、復旧が共通App上で動く |
| 10 | Webのコード生成・配布の移行 | Blockly・顔エディター・Galleryが新APIを生成し、保存済みプロジェクトを移行する |
| 11 | 旧API・互換アダプターの撤去 | リポジトリ内の利用箇所が移行済みで、新SDKによる配布と復旧が検証されている |

第2段階で画面と常駐処理の寿命を実際に操作してレビューし、後続のサービスはその契約に従います。
サンプルと資料は対応するAPIのPRで移行し、最後に一括移行を残さないようにします。
公開APIを変更する判断も、その段階のPRでこの契約へ反映してから後続へ適用します。

## 所有と互換性を振る舞いで検証する

Appと入力の検証はXS上で行います。
通常MOD、miniapp単独、複合archive、Compartment内のPiu生成、起動失敗、遷移連打、100回の画面切替、常駐処理の継続を確認します。
購読解除で開始済みの処理が完走できることと、所有者終了で処理が取り消されることを別々に確かめ、pettingの配送も検査します。

音声では同時再生、途中停止、混合済みバッファの寿命、終了通知の例外を検証します。
motionでは許容境界、実測値の途中逸脱、timeout、estimatedを確かめます。
会話ではTool実行中の効果音と、App切替後の常駐会話の継続を検証します。
機器に関わる変更は該当PRで実機確認を行い、ホスト変更では初代M5Stackを含めて容量を確認します。

#692でSDK移行を済ませた旧MODのソースAPIは、撤去PRまで維持します。
旧バイナリを無変更で使えることは保証せず、再ビルドと必要なimportの移行を前提にします。
不正な新形式を旧loaderへ迂回させないこと、required capability不足のMODを評価しないことを検査します。

## 統合PRでdevelopへ戻す

全段階を取り込んだ後、最新developを同期し、全サンプル、WASM、全6機種のrelease成果物、Web配布、復旧経路を検証します。
milestoneからdevelopへの統合PRには、分割PR一覧、最終仕様、移行手順、検証したコミットと結果を記載します。
同期時の競合解消もレビュー対象に含め、承認後にmerge commitで取り込みます。
取り込み後、#701へ分割先を記録して閉じます。

準備PRのリリース影響はnoneです。製品動作を変更しないCIと設計文書のため、Changesetは追加しません。
SDK追加はminor、既定動作の内部移行はpatchを基本とし、Web生成の必要ホスト世代の切替と旧API撤去はmajorとして移行手順を付けます。
各PRでChangesetを蓄積し、最終統合のリリース影響はmajorとします。
Changesetsの基準ブランチはdevelopに保ち、製品versionの更新と正式配布は[通常のリリース工程](./release-flow_ja.md)で行います。
