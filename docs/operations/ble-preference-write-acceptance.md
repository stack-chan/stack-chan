# BLE preference write acceptance

BLE preference writes are disabled until Settings is opened on the device. The
window lasts five minutes from entry and closes when Settings is exited. A BLE
reconnection does not extend it. Leave and reopen Settings to start a new window.
Only exact `domain.key` names from `PREF_KEYS` may be changed; platform-locked
preferences remain read-only.

This is a physical opt-in window, not client authentication. Any nearby client
can still write supported, unlocked preferences while that window is open.

## Automated checks

From `firmware/`, run:

- `npm run test:unit`
- `npm run lint`
- `npm run format`
- `npm run check:architecture`
- `npm run check:manifest` with the Moddable SDK environment loaded
- `npm run test:moddable -- host/modules/connectivity/__tests__/preference-write-window-xs/manifest.test.json`

The focused XS test uses the actual Timer with fake BLE and preference storage.
Node tests cover the five-minute boundary, fragmented JSON, exact property names,
string-valued settings, timer cleanup, reconnection, and existing read-only and
effective-value behavior. These checks do not establish physical BLE behavior.

## Physical acceptance checklist

Use a test device and disposable settings, recording the firmware revision and
device model. Do not use production Wi-Fi passwords or service tokens.

1. Boot normally without entering Settings. Verify that BLE preference writes
   cannot alter persistent settings.
2. Open Settings on the device and connect the existing web configuration page.
   Verify a supported string preference and a numeric preference sent as a string
   persist and are reflected by notifications. Verify an empty string still clears
   an applicable setting.
3. Send an unknown domain, unknown key, and `wifi.ssid.extra` using both single
   `{prop, value}` and `_batch` messages. Verify these do not change stored values
   or invoke preference-change callbacks. Verify valid batch entries still work.
4. On a platform that locks `driver.type`, attempt to change it during the window.
   Verify that the effective platform value is returned with `readOnly: true` and
   the stored driver preference is unchanged.
5. Verify writes just before five minutes succeed, and writes at/after expiry do
   not persist. Start a fragmented write before expiry and finish it afterward;
   verify that it is rejected. Check stored values after reconnecting or rebooting.
6. Disconnect and reconnect during the window. Verify incomplete messages from
   the previous connection are discarded and the original expiry remains in force.
7. Exit Settings using Back and Boot, including with an incomplete message in
   flight. Verify no writes persist afterward. Reopen Settings and verify a fresh
   five-minute window works with no stale fragments or timer effects.

The existing web client confirms transport submission, not device persistence.
After expiry its send operation may still appear successful; reconnect/readback
or reboot verification is required. A device acknowledgement/error protocol and
its UI treatment are separate work.
