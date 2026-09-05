---
"stack-chan": major
"stackchan-web": major
---

Move firmware, browser compiler, and simulator to Moddable SDK 9.5.0.
Update HTTP, NTP, DNS-SD, and CoreS3 power access for the new platform APIs, and isolate HTTP request state across keep-alive requests.

Web Editor installation now requires a 9.5.x host; update older 8.3.x or 9.0.x firmware before installing MODs.
XS archive checks follow the host's compatible major/minor range (17.7–17.8), including patch revisions.
MOD sources that import legacy `sntp`, `mdns`, or classic network sockets must migrate to the exported ECMA-419 providers and be rebuilt.
