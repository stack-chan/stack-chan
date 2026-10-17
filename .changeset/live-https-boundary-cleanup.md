---
"stack-chan": patch
---

Keep fixed-length Realtime HTTPS requests alive on zero writable capacity, and suppress late DNS callbacks after request cleanup so a timed-out client cannot open another socket.
