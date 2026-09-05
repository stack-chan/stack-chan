---
"stack-chan": patch
---

Release registered firmware devices when context initialization fails, await asynchronous cleanup, and preserve the original startup error.
Close input subscriptions, LED effects, active mini apps, and Piu views with their runtime owner. Prevent closed input drivers from restarting or dispatching late events.
Settle camera operations on shutdown, discard late frames, and release the native camera even when stopping fails.
