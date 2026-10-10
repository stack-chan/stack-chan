---
"stack-chan": minor
---

Reuse the Moddable 10 Core2/CoreS3 device providers while retaining Stack-chan
camera bus, polling touch, head touch panel, servo, power, audio and USB wiring.
Use standard lowercase bus names and SDK-composed provider typings. Remove
unused Analog, SPI, PulseCount and PulseWidth native IO from the host; custom
MODs requiring those classes need a host that includes their SDK IO manifests.
