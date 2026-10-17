---
"stack-chan": minor
---

Expose the built-in ST25R3916 as `device.sensor.RFID` on M5StackChan CoreS3,
using the official Moddable SDK driver on the shared internal I2C bus.
RFID remains opt-in. Add a sample MOD for UID detection/removal, selectable
polling, antenna shutdown, and explicit Type 2 NDEF URI write/read-back.
MIFARE Classic data IO is not supported.
