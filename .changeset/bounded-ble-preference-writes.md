---
"stack-chan": patch
---

Allow BLE preference writes only for five minutes after opening Settings on the device, and only for supported preference keys. Leaving Settings closes the write window; open Settings again to renew it. Platform-locked preferences remain read-only.
