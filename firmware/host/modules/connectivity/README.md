# Wi-Fi low-latency connections

M5StackChan CoreS3 uses `WIFI_PS_MIN_MODEM` when no latency-sensitive connection is active. A main-thread MOD can keep Wi-Fi awake with the `network-power` module:

```js
import power from 'network-power'

const lease = power.acquireLowLatency()
try {
  await connectAndRun()
} finally {
  try {
    await closeTransport()
  } finally {
    lease.close()
  }
}
```

Acquire before authentication or signaling begins. Keep the lease while connecting, listening, waiting for a reply, playing audio, and closing the transport. Silence or microphone mute does not end a connection. Release after transport teardown, including failed or cancelled starts.

Leases overlap safely. Closing an old lease, including closing it twice, cannot release another connection's lease. The final release selects `MIN_MODEM`; at least one lease selects `NONE`. NetworkService initialization and reconnect preserve outstanding requests and reapply the policy. Duplicate requests do not rewrite a mode that is already applied.

`power.getWiFiPowerSaveMode()` reads actual driver state as `'none'` or `'min-modem'`. It returns `undefined` on targets without the native capability. Those targets retain their existing Wi-Fi behavior. Native set/get failures throw; a failed acquisition creates no owner. A failed release removes ownership and throws, and the next policy operation retries the desired setting.

Only the main VM owns leases. Audio Workers request lifecycle changes through their main-thread owner. All latency-sensitive MOD connections must use this API; older MODs that rely on Wi-Fi always being awake need updating when installed with this host.

For Stack-chan AI, the MOD owns the conversation and downlink policies. An idle audio downlink connection still holds a lease to protect incoming audio, so it can keep `NONE` active even outside a local conversation. Power savings depend on having no such connections; current reduction and dynamic-switch audio latency require device measurements.

Verification:

- `__tests__/wifi-power/manifest.test.json`: XS test for initialization order, overlapping owners, service replacement, and mode selection before connecting.
- `__tests__/wifi-power-device/manifest.json`: standalone CoreS3 probe for native set/get, twenty overlapping acquire/release cycles, and invalid-mode rejection. It does not create a paid conversation or issue servo commands.
