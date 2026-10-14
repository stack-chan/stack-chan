---
"stack-chan": patch
---

Allow the M5StackChan PY32 IO expander to apply its LED count before the first RGB write, preventing startup I2C failures on affected devices. LED initialization now includes a one-time 200 ms wait, matching the M5Stack BSP sequence.
