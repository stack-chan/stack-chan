---
"stack-chan": major
---

Merge the LED and CoreS3 smoke examples into the SDK board diagnostics app. Preserve automated servo and LED checks, all LED modes and button controls with app-owned cancellation. Add the host API 5 lighting blink operation with an explicit period in milliseconds. Missing or failed hardware never reports a diagnostic pass. Remove unused flat lighting methods and the duplicate lighting capability adapter; update the device runner to the shared app. Permit torque release after motion faults while keeping the failed motion resource unavailable; preserve the first failure when holding and release both fail.
