---
"stack-chan": minor
---

Move the opt-in Avatar DSL Face MOD animation, AVDS execution, geometry, and rendering loop into a bounded native Piu/Poco backend. Host state updates use the existing Face API and are evaluated on the next native animation tick.

This MOD requires rebuilding the host for its native module. The standard face remains the default; the pinned compiler and numeric VM are unchanged. Preset group extents are adapted for strict clipping, with original sources and bytecode retained as test fixtures.

Reuse unchanged native geometry and publish only changed command records. Batch M5StackChan CoreS3 raster and asynchronous LCD sends into fixed eight-row buffers without changing pixels, SPI speed, or animation cadence. This adds 8.75 KiB of fixed pixel-buffer storage.

Treat `begin_group(x,y,w,h)` as a strict, absolute, half-open clip, intersect nested groups, and restore the parent on `end_group()`. This intentionally changes earlier PR revisions and upstream group-hint behavior: custom programs must enclose every intended pixel. Ungrouped primitives retain the full canvas clip. Correct the omega mouth floor and collar extents to preserve the bundled presets. Repaint the old/new changed visible bounds in source order, retaining full-frame invalidation for first frames and background changes. The minor package impact reflects the new, unreleased opt-in feature; its group semantics are a breaking change from earlier preview builds.
