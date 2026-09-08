---
"stack-chan": patch
---

Serialize SCServo transactions across both axes, preserve recovery delays after missing responses, and recover packet synchronization after malformed input. Attempt torque release on both axes even if one axis fails, while reporting the failure to the caller.
