# ライセンスと実装の出自

## 独自実装

RealtimeConversationは`4eadde0e8792dcfd785b82040168da91b2ba0e69`で新規追加され、その後のCoreS3対応・短期トークン・ツール対応を含め、移植元`085a99b16b316f1b9d5cb1b08c3fabcd4d9e04af`までの対象コミットはmeganetaaan名義で作成されている。ユーザーが示した独自実装という出自と、追加履歴・本文を確認して移植した。型定義・テストも同じ新規追加履歴に属する。

移植先の独自コードにはApache-2.0を適用する。元ファイルに付いていたModdable SDK向けの著作権・ライセンスのテンプレートは引き継がない。移植元ファイルのハッシュを保存し、今後も第三者由来部分が判明した場合に追跡できるようにする。この記録は依存物を含む配布物全体の法的適合性を保証するものではない。

## 取り込まないSDK実装

Moddable由来の`modSPI.c`をコピーした差し替えは製品構成から削除した。`piuView.c`のincludeも削除し、試験時のみ独自のリンク時ラッパーでSDKの関数を呼び出す。SDKのソースは外部の無改修checkoutからビルドする。SDKヘッダーとライブラリへの依存は残る。

## 外部依存

| 依存 | 出自・条件 |
| --- | --- |
| Moddableランタイム | Moddable SDKのファイルごとの条件。主にLGPL-3.0-or-later |
| Moddableビルドツール | SDK ToolsのGPL-3.0-or-later。ツール自体のコードは移植しない |
| ESP-IDF | Espressifの配布条件および個々のコンポーネントの条件 |
| esp-webrtc-solution | `c8650846b512e6e1375e5f78c1c41619b8d645eb`を比較基準とする。コンポーネントごとにLICENSEを確認する |
| esp_peer・av_render | Espressif Modified MIT。Espressif製品に限定する条件があり、通常のMITと同一視しない |
| esp_audio_codecなどの管理依存 | ESP-IDFが解決した`dependencies.lock`と各LICENSEを配布時に確認する |

ソースをコピーしない構成でも、リンクしたランタイムや外部ライブラリの条件はなくならない。Apache-2.0はStack-chan独自部分に適用する。
