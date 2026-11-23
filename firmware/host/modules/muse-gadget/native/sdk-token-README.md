# Native SDK token boundary

実tokenの取得・保存・送信は未承認で、この変更の検証では実行していません。

`sdk-token-store.h`はnative専用です。JSへtoken値を返すAPIはありません。専用namespace`muse_sdk`のkey`sdk_token`だけを扱います。既存`homehub`や`muse_account`には触れず、NVS初期化、erase、eFuse操作もしません。

- `muse_sdk_token_valid`は公式`identity_sdk_token_valid`の形式に従います。pin `f2c702b123e97f4fecdaefb29ded17bb03fab0b0`の`esp32/main/identity.c:103–110`が根拠です。全48文字、`mgst_`接頭辞、base64url文字、末尾`AEIMQUYcgkosw048`のいずれかを要求します。これは形式検査であり、サービス上の有効性を確認するものではありません。
- `presence`はNVS keyの型と長さだけを確認します。`MSDK_EXISTS`は内容が有効なことを保証しません。
- `read`はnativeの49byte bufferへ読み、形式を検証します。失敗時はbuffer全体をzeroizeします。
- `store_if_absent_approved`は呼出元が明示承認を確認した後にのみ呼びます。既存keyは型不正でも上書きしません。単一write、1回commit、readback一致後にのみ`MSDK_OK`です。失敗時は保存済みの可能性があり、自動erase/rollbackはしません。

PairingNativeのconstructorはStart時にnative読込みを行い、owner内の49byte bufferを公式`link_pairing_init`へ渡します。未設定・不正・読取り障害は固定errorで停止します。tokenは暗号化`pairing_confirmed`に公式coreが組み込みます。その処理を呼ぶには別途送信の承認が必要です。closeでは公式coreの参照を解除してからowner全体をzeroizeします。tokenのprefixを含めログ出力しません。

productionにはno-token bypassを設けません。公式crypto harnessは実NVSとは接続せず、NULLまたは明示fixtureで公式coreを直接テストします。native host validationもfixtureだけを使います。

`account-tests/run.sh`にSDK store mockを追加しました。形式、長さ、末尾bits、presenceで値を読まないこと、未設定、既存上書き拒否、型不正、書込み/commit/readback失敗、失敗時buffer zeroizeを検証します。実tokenを生成したりサービスへ照会したりするテストではありません。
