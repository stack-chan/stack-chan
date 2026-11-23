# Community pairing v5 boundary

`pairing-native` wraps the unchanged Muse SDK at
`f2c702b123e97f4fecdaefb29ded17bb03fab0b0`. Crypto and transcript construction
come from upstream `link_pairing.c`, `pairing_transcript.c`, and
`pairing_signer_policy.c`. The optional IDF component is
`stackchan_muse_pairing` (`pairing_component/`). It compiles only the community
mode, never manufacturer eFuse attestation. No eFuse writes exist here.

The caller supplies node ID and MAC. Pairing device ID is derived from the
validated, lowercase MAC as `hatch-link:MAC`; the constructor's legacy
`deviceId` argument is no longer used. Identity is retained for the singleton's
lifetime but not persisted by PairingNative. Start loads the SDK token into
native owner memory from the dedicated `muse_sdk` store; missing or invalid
tokens fail closed. No token is generated or returned as plaintext to JS.
An explicitly invoked hello creates the upstream ephemeral session.
PairingNative does not start BLE advertising or network connections.

## API

- `info()` returns device information JSON with `type: device_info`.
- `hello(json)` returns the public server hello.
- `receive(encryptedJson)` accepts the exact encrypted finished command or,
  after confirmation, a provisioning command or exact `wifi_scan` command.
  It never returns plaintext.
- Finished returns `{kind: 'finished', generation, confirmationRequired}`.
- `status(name, generation)` supports `confirm_required` and
  `pairing_confirmed`, returning `{json, recordGeneration}`. The caller must
  finish sending the encrypted confirmation prompt before `arm(generation)`.
- Confirmed `wifi_scan` returns `{kind: 'wifi_scan', generation}` without
  resetting the session or touching staged credentials. `scanResult(generation)`
  returns `{json, recordGeneration}` containing an encrypted
  `wifi_scan_result` with an empty `networks` list. It does not scan or fabricate
  nearby networks. The official Linux implementation also allows an empty
  list; manual SSID entry in the phone application is not verified.
- Progress statuses `wifi_connecting`, `wifi_connected`, `auth_ok`,
  `wifi_failed`, `auth_failed`, and `error_storage` require a current
  provisioning generation. The caller must report actual completed stages;
  `auth_ok` is not appropriate for mere account preparation.
- `confirm()` is reserved for an explicit physical user-confirmation event.
- `current(generation)` checks phase identity; `recordCurrent(token)` checks
  encrypted record identity across phase transitions. The BLE owner must poll
  `current` at least once per second while retaining a session, and reset on
  disconnection. Polls also erase expired staging.
- `reset()`, `discard()`, and `close()` erase staged plaintext. A new hello
  erases any previously staged payload before beginning another handshake.

Provisioning returns only `{kind: 'provision', generation, provisionReady: true}`.
The decrypted JSON remains in native RAM, at most 8192 bytes. There is **no
export, commit, NVS, Wi-Fi, HTTP, endpoint-update, OTA, or token-mint API**.
Current staging alone does not complete setup.

Validation requires unique string fields `action`, `ssid`, `password`,
`access_token`, `refresh_token`, and `token_type: device`. Optional `username`,
`api_url`, `api_url_v2`, and `noise_host` are bounded strings. Endpoint fields
are inert data, not approved destinations; a future commit implementation must
validate and obtain any necessary approval separately. Unknown fields,
including OTA fields, are rejected. Embedded NUL escapes, excessive nesting,
duplicate fields, empty required values, and overlong strings are rejected.
Errors do not include supplied contents. Both temporary parse-tree strings and
retained staging are zeroized before release.

## Verification

`pairing-tests/run.sh` runs:

1. The binding's actual validation and staging helpers: required/type/duplicate/
   unknown/overlong/NUL/depth checks, optional endpoint acceptance, explicit
   discard, expiry, and destructor zeroization before free. Only the session
   clock/state and zeroization hooks are synthetic; no cryptography is mocked
   in the separate handshake test.
2. Four unchanged upstream tests covering transcript vectors, signer policy,
   and the real-crypto handshake in community and test-eFuse modes. The eFuse
   test substitutes a throwaway synthetic scalar, never real hardware keys.

Both suites passed under WSL with the installed ESP-IDF crypto sources.
The binding also passed XS-header `-Wall -Wextra -Werror` syntax checking.
No live BLE pairing, credential provisioning, or persistent write was performed.
An actual ESP32 build/runtime test of this binding remains separate.
