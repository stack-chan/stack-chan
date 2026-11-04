---
"stack-chan": patch
"stackchan-web": patch
---

Update firmware, typings, CI, and the browser MOD compiler/simulator to Moddable SDK 10.1.0, including its TLS 1.2 server authentication security fix. Rebuild the host firmware to receive the fix; updating a MOD alone does not update TLS.

Follow the SDK's relocated IO modules and preserve the classic HTTP module's explicit socket dependency. Web and CLI MOD installation recognize SDK 10.1.x hosts with XS 17.7–17.9 archives. SDK 9.5 and 10.0 retain their existing archive ranges; unknown SDK versions remain rejected. Archive compatibility does not guarantee that the host provides every module or capability a MOD needs.

Experimental TLS 1.3 is not enabled. Audio sample rates and the host API generation remain unchanged.
