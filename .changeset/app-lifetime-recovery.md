---
"stack-chan": patch
---

Report failures from late asynchronous app cleanup and connection observers without reopening closed resources. Keep the last successful dialogue history when a request fails, is cancelled or exceeds its limits, so the next request can recover consistently.
