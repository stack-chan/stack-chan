---
"stack-chan": patch
---

Release the realtime HTTPS worker after its request queue becomes idle, and recreate it when needed. Preserve pending signaling and hangup requests while allowing worker memory to be reclaimed between conversations.

Await optional MOD cleanup before context audio shutdown, and retry failed lazy codec registration without eagerly initializing unused conversations.
