# Opt-in community pairing transport

This module maps the setup peripheral in `facebookincubator/muse-gadget-sdk`, commit `f2c702b123e97f4fecdaefb29ded17bb03fab0b0`, `esp32/main/ble_server.c` and `app.c`, onto the Moddable classic BLE server. It is not started by the Muse host.

## Wire contract

- Service: `7fdd3d1c-38ea-46cf-8b46-314ecf5f240c`.
- RX: `4d593029-28a2-4a6e-a1f0-3c2d5e8f9b01`, write and write-without-response.
- TX: `d75dc4ca-7b2b-4e9c-8f0a-1d2e3f4a5b6c`, read and notify.
- Notifications carry `[0xFE, zero-based index, total]` followed by JSON UTF-8 bytes. Payload capacity is `min(MTU - 3, 160) - 3`; sends are separated by 50 ms. A record has at most 255 chunks. RX also accepts unframed JSON, validates ordered chunks, and caps records at 8192 bytes.
- Advertising: flags 6, complete service UUID, manufacturer identifier 0xFFFF with unpaired byte 0. Complete local name is in scan response. There is no automatic re-advertising on disconnect.
- TX reads show only `idle` or `encrypted_status`, never decrypted status or credentials.

## Security and lifecycle boundary

Importing the module does not construct a BLE server. Calling `createPairingPeripheral` initializes the radio; calling its separate `advertise()` begins advertising. Neither is invoked by the fixture entry point. The caller must obtain authorization before those steps, supply the identity/native object explicitly, and confirm the device is unpaired by supplying setupComplete:false. Unknown or already-complete state is rejected before radio construction.

The supported path is device info, client hello, encrypted finished, encrypted `confirm_required`, physical confirmation, encrypted `pairing_confirmed`, then opaque provision staging. The physical confirmation hook is armed only after all prompt chunks have been submitted in order. `confirmPhysical()` must be wired to a distinct user touch, not to a network command or the prompt callback. The classic SDK notification API discards the NimBLE send return code, so this module uses a small native adapter with the public connection and characteristic handles. It checks allocation and queue acceptance, matching the official failure boundary without modifying the shared SDK. Queue acceptance is not proof the phone received the message.

Cryptographic transcript, record counters, signer policy, and decryption remain inside the native upstream binding. Provision credentials remain in native RAM; `onProvision` receives only generation and readiness booleans. There is no credential export, persistent commit, Wi-Fi connection, account request, endpoint change, OTA, or unpair action here. Unsupported commands fail closed. Native expiry is polled once per second; disconnect/close reset the native session and staging. JavaScript reassembly buffers are cleared, but JavaScript strings are garbage-collected and cannot offer a physical-memory zeroization guarantee.

The native `current` and `recordCurrent` tokens distinguish handshake-phase changes from replacement encryption sessions. An epoch prevents an old delayed send from arming or releasing a new session. Callback errors are not logged, and secrets are never included in status or diagnostic messages.

## Verification

`node --experimental-vm-modules --test host/modules/muse-gadget/pairing/*.test.mjs` tests framing, confirmation ordering, plaintext rejection, stale-session races, expiry, opaque staging, and BLE adapter mapping using mocks. It does not establish phone compatibility or real pairing success.

`node scripts/build-muse-native-device.mjs --pairing` builds an isolated StopWatch target. Its `main` imports the real BLE and native bindings, runs a framing and native-lifetime fixture, and initializes the native binding with an explicit test-only identity to check info/reset/close. It does not instantiate the BLE server, send a hello, advertise, create keys, pair, or save credentials. Hardware execution and authorized interactive pairing are separate steps.





The 1,189,056-byte fixture image was flashed to COM18 at application offset 0x20000 on 2026-11-15. Serial reported MUSE_PAIRING fixture_pass radio_not_started; the 15-second observation had no panic or repeated reset. Only the test-only native lifecycle and framing ran. NVS and partition table were unchanged; no BLE server was constructed, no advertising/phone pairing occurred, and no credentials were created or stored.
