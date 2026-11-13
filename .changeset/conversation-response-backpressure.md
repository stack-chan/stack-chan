---
'stack-chan': patch
---

Pause LLM response reads while speech consumes an event, keeping at most one bounded chunk instead of failing when a short burst fills the callback queue. Cancel outstanding speech work when a conversation turn fails so it cannot outlive that turn.
