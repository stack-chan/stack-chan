---
"stack-chan": patch
---

Await asynchronous operation cancellation before handing a shared resource to the next operation. Bound stop requests with a deadline, and keep failed resources closed.
Invalidate motion callbacks and timers when replacing a driver, settle old commands once, and roll back failed attachments.
Keep DYNAMIXEL targets requested during initialization or a pending UART acknowledgement, and track only the goal actually transmitted as acknowledged.
