# CoreS3 performance measurements

Include `manifest.performance.json` in a test host and set
`STACKCHAN_REALTIME_WEBRTC=1 STACKCHAN_REALTIME_PERFORMANCE_PROBE=1`.
The build wrapper registers the measurement component without modifying the SDK.

The test implementation overrides the normal host's no-op measurement hooks.
It measures completed display frames, I2S progress, and optional task diagnostics.
The normal runtime retains its clock, audio levels and task-priority controls.
Audio underrun counters remain part of the normal transport statistics.

Memory samples include `freeInternalHeap`, `largestInternalBlock`, and
`nativeStackFree`. The last field is the calling task's stack high-water mark;
a sample from main does not measure the HTTPS Worker's stack.

SystemView capture additionally requires `task-trace/manifest.json` and
`STACKCHAN_REALTIME_SYSTEM_TRACE=1`. Captures are bounded and rejected when
writes were dropped. The codec and display wrappers call the original SDK
functions; they do not replace the implementations.

These measurements do not establish end-to-end acoustic latency. Report
session completion, measured UI/audio limits, and listening results separately.
