---
"stack-chan": minor
---

Move the opt-in Avatar DSL Face MOD animation, AVDS execution, geometry, and rendering loop into a bounded native Piu/Poco backend. Host state updates use the existing Face API and are evaluated on the next native animation tick.

This MOD requires rebuilding the host for its native module. The standard face remains the default; the pinned preset sources, compiler, and bytecode are unchanged.

Reuse unchanged native geometry and publish only changed command records. Batch M5StackChan CoreS3 raster and asynchronous LCD sends into fixed eight-row buffers without changing pixels, SPI speed, or animation cadence. This adds 8.75 KiB of fixed pixel-buffer storage.
