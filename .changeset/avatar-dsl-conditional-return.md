---
"stack-chan": patch
---

Fix Avatar DSL functions ending in a conditional return being rejected by the runtime or falling through into the next function. The compiler now always emits an implicit return so every function has a valid fallthrough target.
