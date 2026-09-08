---
"stack-chan": patch
---

Preserve SDK error codes across networking and propagate cancellation into local-peer discovery, reliable sends, broadcasts and unfinished opens. Stop pending retries and fragments while keeping the connection reusable after an operation is cancelled. Share peer data types and errors with the SDK, and release conversation/network subscriptions exactly once.
