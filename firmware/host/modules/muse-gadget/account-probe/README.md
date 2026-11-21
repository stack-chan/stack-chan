# Account connection probe

Build with `node scripts/build-muse-native-device.mjs --account-probe`.
This opt-in diagnostic restores the existing native account, connects its saved Wi-Fi,
synchronizes the real clock, and performs the approved account HTTP flow. It does not
start audio or a voice session. A successful authentication refresh may update the
stored account tokens, so this is not a read-only test. Run only with authorization
for the actual service connection.

Output is restricted to fixed stage and failure names. Credentials, network names,
HTTP bodies and arbitrary exception text are never printed. Use a whitelist serial
monitor rather than forwarding platform logs. `account_ready` means HTTP account
preparation succeeded, not that a Muse voice conversation has connected.

The NTP provider requires the embedded socket manifest. Native account HTTP requires
`CONFIG_ESP_HTTP_CLIENT_ENABLE_HTTPS=y`; the native build rejects missing HTTPS support.
Certificate and hostname verification stay enabled.
