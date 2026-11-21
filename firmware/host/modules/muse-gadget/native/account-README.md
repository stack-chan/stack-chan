# AccountSession: native owner and offline validation

ユーザーの最終承認は未取得です。XS export、NVS書込みadapter、HTTP workerをpairing manifestに登録していますが、実機の保存・認証・通信は実行していません。constructorは保存・通信せず、呼出元は明示承認後にのみcommitApproved/connectApprovedを呼ぶ必要があります。テストは固定fixtureと注入callbackだけで実行します。

`import {AccountSession} from 'muse-pairing-native'`で利用します。`new AccountSession(pairingOwner, generation)`はnative内でstagingをclaimし、元のplaintextをzeroizeします。claimは一度だけ成功します。`current(generation)`はAccountSessionが閉じられておらず、そのownerのgenerationと一致することだけを保証します。claim後は独立所有なので、元のBLE sessionの切断・期限切れでAccountSessionが失効するわけではありません。保存承認を取り消した時はAccountSessionをcloseする必要があります。constructorは保存・通信しません。

`commitApproved(generation)`はNVS commit後に別handleでreadbackし、全byte一致した場合だけ`{saved:true}`を返します。失敗は固定メッセージの例外となり、同じownerから明示的に再試行できます。`connectApproved(generation)`はworkerを開始し、JS mainの25ms Timerで完了を確認するPromiseを返します。成功値は`{prepared:true}`で、Noiseの接続成功ではありません。二重開始を拒否し、closeはPromiseを直ちにrejectしてTimerを止め、worker終了までnative側がcredentialを保持します。closeは冪等です。cancelはworkerへ取消を要求し、Promiseはworker結果の回収後にrejectします。

`AccountSession.restore()`は専用namespaceをNVS_READONLYで読み、version・項目・型・長さ・重複を検証してopaque ownerを返します。credentialはnativeだけで扱い、保存・通信しません。device idはchipのSTA MACからsetupと同じ`stopwatch-xxxxxxxxxxxx`形式で導出します。`owner.generation`はprocess-localの非零連番で、永続化しません。再起動後は新owner用に発行し直します。これは承認や認証tokenではありません。

専用recordが無い場合は`account record absent`、型・内容不正は`account record invalid`、読取り障害は`account store unavailable`という固定メッセージをthrowします。legacyの`homehub`や`muse`を読み込んで移行する処理はありません。restore後も通信を始めるには別のConnect承認が必要です。

## 実装済みの境界

`account-session-core.h`はopaqueな`MuseAccount`を扱います。JSONからclaimする入口はC専用です。claim前後に渡されたgenerationの有効性を確認し、endpoint、必須項目、重複項目、サイズ、埋込みNULを検査します。呼出元はclaim成功後に元のstagingを破棄する責任を持ちます。

`commit_approved`は同じgenerationの場合だけ単一blobをstore callbackへ渡します。`connect_approved`はcommit成功後だけHTTP callbackを呼びます。これらの名前やgenerationチェックはユーザー承認を取得する機能ではありません。将来のUI adapterが保存と通信の承認を別々に確認する必要があります。

HTTPは`https://api.muse.ai`の`/fetch_vms`と`/device_token/refresh`のみです。fetchの401後にrefresh tokenで一度だけrefreshし、更新されたpairを保存してから再fetchします。fetchの403はrefreshせず拒否します。mint、SDK token、OTA、任意endpoint、無制限retryはありません。refreshの401は`MA_REVOKED`、403は`MA_AUTH`です。refresh後の保存失敗は`MA_STORE`となり、再commitまで次のconnectを拒否します。保存済みデータを消去しません。

公式SDKの`vm_api.c`にあるrefresh bearer生成を参照しています。参照pinは`f2c702b123e97f4fecdaefb29ded17bb03fab0b0`です。fetchの403でrefreshしない点は、このintegrationの制限です。実サーバとのTLS、HTTP headers、証明書、ESP-IDFの挙動は未検証です。

VM bearerはnative sinkにだけ渡します。Noise hostは`hatch.metaaivm.com`に固定し、サーバ応答のURLを接続先として使いません。VM id必須の最小実装で、URLからのid推定はありません。

旧firmware向け`api_url`は1024byte以下の文字列として受理しますが、保存も接続先利用もしません。現行`api_url_v2`は固定originとの完全一致を要求します。pairingの`device_id`は公式の`hatch-link:MAC`形式、refreshへ渡す`node_id`はsetupとrestoreで統一した`stopwatch-xxxxxxxxxxxx`形式です。

## adapter契約

- HTTP callbackは同期で、redirectを実際に追う前に拒否します。coreのredirect結果チェックだけでは送信先制限を保証できません。Authorizationとbodyをログに出してはいけません。response capacityを超えて書き込んではいけません。
- store callbackは専用namespace`muse_account`、key`record`の単一blobだけを書き、一度commitします。既存`homehub`、`wifi`、NVS初期化、partition、eFuse、eraseには触れません。実NVSと停電耐性は未検証です。原子性はESP-IDFの単一blob更新機構に依存します。commit/readback失敗時は新blobが保存されている可能性があり、旧blob保持を保証しません。eraseやrollback書込みは行いません。
- callbackの文字列は借用です。callback終了後に保持してはいけません。Noise sinkが必要な値を自己所有領域へコピーします。
- 同一ownerの操作は直列です。callback中のcloseは処理終了まで破棄を遅らせ、その操作は`MA_STALE`になります。終了後のowner pointerは使用できません。非同期worker化には別のlifetime管理が必要です。
- coreのconnect成功はVM bearer解決までです。実WiFi/Noise接続成功ではありません。UIはこの段階だけで「接続済み」を返してはいけません。
- WiFi接続済みかつNTP成功後にのみHTTP準備を開始します。HTTP adapterも2024年より前の時刻を拒否しますが、それだけではNTP成功の証明にはなりません。setup targetのcertificate bundleはFULL構成で、buildのbundle実体とobjectを確認しています。
- credential、HTTP response、JSON value、永続化用blobは解放前にzeroizeします。OS/allocator/ESP-IDF内部の複製まで消去する保証はありません。

## 検証

WSLで`bash firmware/host/modules/muse-gadget/native/account-tests/run.sh`を実行し、ASan/UBSanと`-Wall -Wextra -Werror`で`MUSE_ACCOUNT_CORE_PASS`を確認しました。

世代不一致、endpoint拒否、重複token、承認前の無副作用、保存、fetch成功、refresh成功、fetchの403、refreshの401/403、refresh後保存失敗、redirect、response上限超過、重複VM token/default、埋込みNUL、store/HTTP callback中のcloseを検証します。NVS mockではnamespace/key限定、1回commit、set失敗時の旧blob保持、commit/readback失敗時の成功拒否を確認し、`MUSE_ACCOUNT_NVS_MOCK_PASS`を得ました。

`pairing-tests/run.sh`のhost harnessではstagingの世代不一致、claim一度限り、移管元のzeroize、BLE owner破棄後のAccountSession独立所有、期限切れstaging拒否を検証します。実credential、実ネットワーク、実NVSは使いません。

## HTTP worker

`account-http.c`はHTTPS、certificate bundle検証、hostname検証を必須とし、redirectと自動認証retryを無効にします。2つの固定path以外はclient作成前に拒否します。response上限超過、負のchunk length、cancel、deadline後のresponseは成功にしません。

`HTTP_CLIENT`はIDFのdebugログでAuthorizationを含むheader全文を出すため、`HTTP_CLIENT`と`HTTP_HEADER`の実効log levelがNONEでなければadapterは拒否します。worker開始時にこの2つのtagだけをNONEに設定しgetterで検証します。wildcard設定は変更しません。ESP-IDF内部が作るheaderコピーのzeroizeは保証できません。

workerはcoreの所有権を受け取り、main側のcore pointerをNULLにします。mainとtaskが各1つのreferenceを持ち、UI close相当のreleaseはcancel flagを立ててmainのreferenceだけを解放します。workerは終了までownerを保持するため、通信中にUIが閉じてもuse-after-freeを起こしません。coreの処理が終わった後だけmainがtakeでき、2回目のtakeは拒否します。XS callbackはworkerから呼びません。操作はmain側の単一consumerから行う契約です。

clientの作成・perform・close・cleanupは同じworkerだけが行います。`is_async`でperformを再開し、開始時から15秒のabsolute deadlineとatomic cancelを再開前後に調べます。`timeout_ms=15000`は別途I/O timeoutです。内部DNS処理等が戻るまでdeadlineを確認できないため、wall clockで必ず15秒以内にworkerが終了する保証はありません。IDFのevent戻り値だけでperformが止まる保証もありません。

`esp_http_client_cancel_request`は内部でsocketを再接続するため使いません。cancel時はworkerがperformから戻った後にclose/cleanupします。取消後のVM bearerは無効化し、準備完了として公開しません。既に始まっていたNVS書込みは取消で巻き戻しません。

mockは`MUSE_ACCOUNT_HTTP_MOCK_PASS`と`MUSE_ACCOUNT_WORKER_MOCK_PASS`を出します。TLS/redirect/auth retryのconfig、log level条件、header設定失敗、overflow、chunk異常、HTTP失敗、401、deadlineによる再開停止、task生成失敗時の所有権返却、worker終了前のtake拒否、UI release後のworker寿命、通信中cancelを検証します。実FreeRTOS並行実行と実サーバへの通信は未検証です。

`node native/account-tests/binding.test.mjs`はnative関数とTimerをmockにして、Promise準備完了、二重開始、close時の即reject、古いTimer callback、cancel、Timer確保失敗時のowner破棄を検証し、`MUSE_ACCOUNT_JS_BINDING_MOCK_PASS`を返します。

## Approved WiFi-only replacement

`muse_account_nvs_update_wifi_approved(ssid, password)` is a native-only entry for the dedicated USB maintenance image. It requires prior user approval and exclusive ownership of account storage: no HTTP refresh worker or other account writer may run concurrently. It does not provide cross-task compare-and-swap.

`MA_WIFI_UPDATED` means the existing validated version-1 record was reserialized with only SSID/password changed, committed once, and read back identically. Access/refresh tokens and version are retained; the SDK namespace is never opened. `MA_WIFI_ABSENT` permits the caller's separately authorized fallback store without creating a dummy account. `MA_WIFI_INVALID` and `MA_WIFI_IO` must stop the operation. IO failure can mean a write persisted but could not be verified; there is no erase or rollback.

Inputs follow the existing account schema: SSID 1–32 bytes, password 1–63 bytes, no CR/LF. All account copies and serialization/readback buffers stay native and are wiped on release. Public-fixture tests cover token preservation, invalid/absent records, write/commit/readback faults and owner approval/ready-state behavior. No real device write is performed by those tests.
