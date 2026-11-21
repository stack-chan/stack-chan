# Wi-Fi scan probe

Build with `node scripts/build-muse-native-device.mjs --scan-probe`.
This opt-in application performs one real scan with the same module used by
Muse pairing, prints only the result count (0–16), and closes the temporary
Wi-Fi owner. It does not connect, start BLE, authenticate, or write preferences.
Network names and passwords are not printed. An actual empty result and a failed
scan produce different fixed output markers.
