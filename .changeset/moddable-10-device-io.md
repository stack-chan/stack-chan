---
"stack-chan": minor
---

Reuse the Moddable 10 Core2/CoreS3 device providers while retaining Stack-chan
camera bus, polling touch, head touch panel, servo, power, audio and USB wiring.
Use standard lowercase bus names and SDK-composed provider typings while
retaining the SDK legacy bus aliases and RTC constructor. Keep Analog, SPI,
PulseCount and PulseWidth native IO and their config modules available to
existing MODs.
